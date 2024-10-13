/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/

/**
 * Support for a Brother P-Touch printers, only tested with PT1230PC
 * See the "references" folder for details of the protocol for similar devices.
 * Also https://github.com/cbdevnet/pt1230
 *
 * To avoid having to write a device driver (or farting about with
 * npm usb), the comms with the printer are done via the /dev/usb/lp0
 * interface. This *should* be a bidirectional file interface, but
 * it has problems when used with node:fs. When the driver sends a
 * status request, the response has to be read immediately or it is
 * lost. When printing, the printer sends status information but
 * similarly it has to be read immediately or it is lost. For this
 * reason the comms are streamlined so that only a
 * specifically-requested status report is read, otherwise commands
 * are just sent.
 */

import fs from "node:fs";
const Fs = fs.promises;
import assert from "assert";

/**
 * An object giving the current status of the printer
 */
class Status {

  /**
   * Interpretation of bits in error_information
   */
  static ERROR_BITS = [
    'No media', 'End of media', 'Cutter jam', 'Weak batteries',
    'Printer in use', 'Unused', 'High-voltage adapter', 'Unused',
    'Replace media', 'Expansion buffer full', 'Comms error', 'Buffer full',
    'Cover open', 'Overheating', 'Black marking not detected', 'System error'
  ];

  /**
   * Default status block, as gleaned from a PT1230PC
   * @private
   */
  static DEFAULT = [
    0x80, 0x20, 0x42, 0x30, 0x59, 0x30, 0x00, 0x00,
    0x00, 0x00, 0x0c, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ];

  /**
   * @param {Buffer} raw a byte buffer containing a status report
   * to be parsed
   * @param {function} debug function
   */
  constructor(raw, debug) {
    
    /**
     * Number of mm of tape to emit to cause an eject. Per model.
     * @member {number}
     */
    this.eject_mm = 0;

    /**
     * Number of pixels in a raster line. Per model.
     * @member {number}
     */
    this.raster_px = 0;

    /**
     * Width of a raster line in mm. Per model.
     * @member {number}
     */
    this.raster_mm = 0;

    /**
     * Number of printable pixels at the centre of each raster line.
     * Per model.
     * @member {number}
     */
    this.printable_width_px = 0;

    /**
     * Width in mm of the printable area. This will always be
     * less than the media width.
     * @member {number}
     */
    this.printable_width_mm = 0;

    /**
     * Current printer phase, one of "Initialisation", "Receiving",
     * "Printing", "Feeding"
     */
    this.phase = "Initialisation";

    if (raw.length < 32)
      throw new Error(`Bad status report, length ${raw.length}`);

    if (raw[0] !== 0x80) throw new Error(`Bad print head mark ${raw[0]}`);
    // raw[1] = Print head size, don't know what this is
    if (raw[2] !== 0x42) throw new Error(`Bad Brother code ${raw[2]}`);
    if (raw[3] !== 0x30) throw new Error(`Bad series code ${raw[2]}`);
    switch(raw[4]) {
      // Obtained from Brother documents. It's anyone's guess what
      // goes in the gaps. Each supported printer has to have an entry
      // in the MODELS object, above.
    case 0x4A: this.model = "PT500PC"; break;
    case 0x59: this.model = "PT1230PC"; break;
    case 0x64: this.model = "PT-H500"; break;
    case 0x65: this.model = "PT-E500"; break;
    case 0x67: this.model = "PT-P700"; break;
    case 0x69: this.model = "PT-P900W"; break;
    case 0x70: this.model = "PT-P950NW"; break;
    case 0x71: this.model = "PT-P900"; break;
    case 0x78: this.model = "PT-P910BT"; break;
    }
    if (raw[3] !== 0x30) throw new Error(`Bad country code ${raw[3]}`);
    // raw[6] Reserved
    // raw[7] Reserved
    if (raw[8] !== 0 || raw[9] !== 0)
      this.error_information = (raw[8] << 8) | raw[9];

    /**
     * Type of media in the printer
     * @member {string}
     */
    this.media_type = "Unknown";
    switch(raw[11]) {
    case 0x01: this.media_type = 'Laminated'; break;
    case 0x02: this.media_type = "Lettering"; break;
    case 0x03: this.media_type = 'Non-laminated'; break;
    case 0x04: this.media_type = 'Fabric'; break;
    case 0x08: this.media_type = "AV"; break;
    case 0x09: this.media_type = "HG"; break;
    case 0x11: this.media_type = 'Heat shrink 2:1'; break;
    case 0x13: this.media_type = "Fle"; break;
    case 0x14: this.media_type = "Flexible ID"; break;
    case 0x15: this.media_type = "Satin"; break;
    case 0x17: this.media_type = 'Heat shrink 3:1'; break;
    case 0xFF: this.media_type = 'Incompatible tape'; break;
    }

    /**
     * Width of tape media in mm
     * @member {number}
     */
    this.media_width_mm = raw[10];

    // Number of colors
    if (raw[12] !== 0) this.number_of_colours = raw[12];
    if(raw[13] !== 0) this.fonts = raw[13]; // Fonts
    if(raw[14] !== 0) this.japanese_fonts = raw[14]; // Japanese Fonts
    if ((raw[15] && 1) !== 0) this.mirror_printing = true;
    if ((raw[15] && 2) !== 0) this.auto_cut = true;

    if (raw[16] !== 0) this.density = raw[16];
    if (raw[17] !== 0) this.media_length = raw[17];
    if (raw[16] !== 0) this.density = raw[16];
    switch (raw[18]) {
    case 0x01: this.status_type = "Printing complete"; break;
    case 0x02: this.status_type = "Error occurred"; break;
    case 0x06: this.statuse_type = "Phase change"; break;
    }

    switch (raw[19]) {
    case 0:
      if (raw[21] === 1)
        this.phase = "Feeding";
      else
        this.phase = "Receiving";
      break;
    case 1:
      this.phase = "Printing"; break;
    }

    switch (raw[22]) {
    case 1: this.cover = "Opened"; break;
    case 2: this.cover = "Closed"; break;
    }

    if (raw[23] !== 0) this['Expansion area'] = raw[23];
    if (raw[24] !== 0) this['Tape color information'] = raw[24];
    if (raw[25] !== 0) this['Text color information'] = raw[25];
    if (raw[26] !== 0) this['Hardware settings 0'] = raw[26];
    if (raw[27] !== 0) this['Hardware settings 1'] = raw[27];
    if (raw[28] !== 0) this['Hardware settings 2'] = raw[28];
    if (raw[29] !== 0) this['Hardware settings 3'] = raw[29];

    // Use the report to determine device dimensions

    // Complete additional information based on printer model
    if (MODELS[this.model]) {
      for (const key of Object.keys(MODELS[this.model]))
        this[key] = MODELS[this.model][key];
    } else {
      throw new Error(`Don't know enough about model ${this.model}`);
    }

    /**
     * Number of rasters to emit to cause an eject
     * @member {number}
     */
	  this.eject_px = Math.floor(
      this.raster_px * this.eject_mm / this.raster_mm + 0.5);
	
    /**
     * Width of a single pixel in mm
     * @member {number}
     */
    this.pixel_width_mm = this.raster_mm / this.raster_px;

    /**
     * Width of tape media in px
     * @member {number}
     */
    this.media_width_px = this.media_width_mm / this.pixel_width_mm;

    debug(
      `PTouch: Tape is ${this.media_width_px}px (${this.media_width_mm}mm) wide`);

    debug(`A raster is ${this.raster_px}px (${this.raster_mm}mm),`,
               `max printable width is ${this.printable_width_px}px`,
               `(${this.printable_width_px * this.pixel_width_mm}mm)`);
    
    if (this.media_width_px < this.printable_width_px) {
      this.printable_width_px =
      this.media_width_mm / this.pixel_width_mm;
      debug(`Tape is narrower than printable area.`,
            `Reducing printable area to `
            + `${this.printable_width_px}px for `
            + `${this.media_width_mm}mm media`);
    }
    this.printable_width_mm = 
    this.printable_width_px * this.pixel_width_mm;
  }
}

// Information about printer models that can't be interrogated from the
// printer. Could be extended with features such as auto-cut, if anyone
// has a printer that supports that!
const MODELS = {
  PT1230PC: {
    // Width of a single raster, must be 18mm even though the PT1230
    // only supports up to 12mm tape.
    raster_mm: 18,

    // Number of pixels in a single raster
    raster_px: 128,

    // Number of pins available. These are in the middle of a raster,
    // so a single raster sent to the printer will have 4 pad bytes
    // before and after the actual printable raster data.
    printable_width_px: 64,

		// Distance the tape has to be rolled before the cutter is clear
		// of the end of the print run (mm)
		eject_mm: 10
  }
};

// Send to clear the print buffer
const INVALIDATE = new Uint8Array(200);
INVALIDATE.fill(0x00/*NULL*/);

// Also used to cancel printing
const INITIALISE_CLEAR = [ 0x1B/*ESC*/, 0x40/*@*/ ];

// Status request, response is analysed below
const SEND_STATUS = [ 0x1B/*ESC*/, 0x69/*i*/, 0x53/*S*/ ];

// PT500 doc says "sets printer to raster mode" for
// 0x1B 0x69 0x61 0x01 and doesn't mention SET_RASTER_MODE
//DYNAMIC_COMMAND_MODE = [ 0x1B/*ESC*/, 0x69/*i*/, 0x61/*a*/ ]

//PRINT_INFORMATION = [ 0x1B/*ESC*/, 0x69/*i*/, 0x7A/*z*/ ]

//MODE = [ 0x1B/*ESC*/, 0x69/*i*/, 0x4D/*M*/ ]

// Follow with 1 byte 0=uncompressed, 2=TIFF
const COMPRESSION = [ 0x4D/*M*/ ];

//ADVANCED_MODE = [ 0x1B/*ESC*/, 0x69/*i*/, 0x4B/*K*/ ]

// Follow with 2 bytes, b1+b2*256 dots
// https://support.brother.com/g/b/spec.aspx?c=gb&lang=en&prod=1230euk says
// "Tape margin settings Large (24.4mm) / Small (4mm)"
const FEED_AMOUNT = [ 0x1B/*ESC*/, 0x69/*i*/, 0x64/*d*/ ];

//Not supported PAGE_NUMBER: [ 0x1B/*ESC*/, 0x69/*i*/, 0x41/*A*/ ],

//Not supported AUTO_STATUS: [ 0x1B/*ESC*/, 0x69/*i*/, 0x21/*!*/ ],

const SET_RASTER_MODE = [ 0x1B/*ESC*/, 0x69/*i*/, 0x52/*R*/ ];

  // Print with feeding
const PRINT_FEED = 0x1A/*SUB/Ctrl+Z*/;

  // Not supposed to feed the tape, but it does! Grr.
const PRINT_NOFEED = 0x0C/*FF*/;

const SEND_RASTER = 0x47/*G*/;

  // PTP900 manual says this is raster mode only!
const EMPTY_RASTER = 0x5A/*Z*/;

class PTouch {

  /**
   * Write to the device.
   * @param {Buffer|Array} buff data to write
   * @return {Promise.<undefined>} promise that resolves to undefined
   * @protected
   */
  write(buff) {
    const b = (buff instanceof Buffer) ? buff : Buffer.from(buff);
    /* c8 ignore next */
    this.debug("->", b);
    return this.fd.write(b);
  }

  /**
   * Reads all available data from the device (up to 16384 bytes).
   * @return {Promise.<Buffer>} promise that resolves to an object
   * with two properties:
   * bytesRead: The number of bytes read
   * buffer: the data read from the device
   * @protected
   */
  read() {
    return this.fd.read(this.device)
    .then(data => {
      /* c8 ignore next */
      this.debug("<-", data);
      return data;
    });
  }

  /**
   * @param {object} params setup parameters
   * @param {String} params.device device name (e.g. /dev/usb/lp0)
   * @param {function?} params.debug function e.g. console.debug
   */
  constructor(params = {}) {

    /**
     * Report function
     * @member {function}
     */
    /* c8 ignore next */
    this.debug = params.debug || function() {};

    /**
     * Pathname of the output device e.g. /dev/usb/lp0
     * @member {string}
     */
    this.device = params.device;

    if (!this.device) throw new Error("No device specified");

    /**
     * Current printer status read from most recent status report
     */
    this.status = new Status(Status.DEFAULT, this.debug);

    /**
     * Flag to indicate successult device initialisation
     * @private
     */
    this.initialised = false;
  }


  /**
   * Promise to get a block of status information about the printer
   * @return {Promise<Status>} promise resolving to a Status object
   */
  getStatus() {
    return this.initialise()
    .then(() => this.status);
  }

  /**
   * Disconnect from the printer
   */
  close() {
    if (this.fd) {
      this.fd.close();
      this.fd = undefined;
    }
    this.initialised = false;
  }

  /**
   * Promise to reset the printer, request a status report and analyse it.
   * @return {Promise.<StatusReport>} promise resolving to the status report
   * @private
   */
  getStatusReport() {
    return this.write(
      [ ...INVALIDATE, ...INITIALISE_CLEAR, ...SEND_STATUS ])
    .then(res => {
      this.debug("WROTE", res.bytesWritten);
      return this.read();
    })
    .then(res => {
      if (res.bytesRead > 0) {
        this.debug("READ", res.bytesRead, res.buffer[0]);
        // Check for print head mark
        if (res.buffer[0] === 0x80)
          return this.status = new Status(res.buffer, this.debug);
      }
      // Recursively try again. Shouldn't take more than a
      // couple of tries. If it does then it'll blow up, but
      // that's OK.
      return this.getStatusReport();
    });
  }

  /**
   * Promise to initialise the device by clearing the device down,
   * and requesting a status report from the device.
   * @return {Promise.<StatusReport>} Promise that resolves to a
   * printer status report
   */
  initialise() {
    if (this.initialised)
      return Promise.resolve(this.status);

    return Fs.open(this.device, "r+")
    .then(fd => {
      this.fd = fd;
      this.initialised = true;
      return this.getStatusReport();
    });
  }

  /**
   * Promise to Eject the tape
   * @return {Promise} Promise that resolves to undefined
   */
  eject() {
    this.debug(`PTouch: Eject ${this.eject_px} rasters`);
    const buff = Buffer.alloc(this.status.eject_px + 1, EMPTY_RASTER);
    buff[buff.length - 1] = PRINT_NOFEED;
    return this.write(buff);
  }

  /**
   * Format and print a monochrome image held in a one-bit-per-pixel buffer.
   * @param {Buffer} image the image buffer (raw pixel data)
   * @param {number} width width of the image
   * @param {number} height height of the image
   * @param {number} bpp bytes per pixel, defaults to 4
   * @return {Promise} Promise that resolves to undefined
   */
  printImage(image, width, height, bpp = 4) {

    /**
     * Read a pixel from the image.
     * @param {number} x x coordinate
     * @param {number} y y coordinate
     * @return {number} 1 if the pixel is black, 0 if it's white
     */
    function getPixel(x, y) {
      // The UI converts the image to 1 bit per pixel, though this is
      // encoded in RGBA with A being 255 for black and 0 for white.
      const offset = (y * width + x) * bpp;
      return image[offset + 3] > 0 ? 1 : 0;
    }

    // Promise to initialise, if needed
    return this.initialise()
    .then(() => {
      this.debug(`PTouch: *** Printing image w=${width} h=${height}`);

      // Each raster is padded by blank bits to centre the image
      const padding = (this.status.raster_px - this.status.printable_width_px) / 2;
      this.debug(`\tStart padding ${padding}px (${padding / 8} bytes)`);

      // The print buffer
      const buffer = [ ...COMPRESSION, 0, // uncompressed
                       ...SET_RASTER_MODE, 1,
                       ...FEED_AMOUNT, 0, 0 ];

      this.debug(` Requires ${Math.ceil(width / this.status.printable_width_px)} tape runs`);

      // Split into tape lengths, each max printable_width_px wide
      let offset = 0;
      while (offset < width) {
        let printwidth = this.status.printable_width_px;
        if (offset + printwidth > width) {
          printwidth = width - offset;
        }

        // Offset to start of raster info for this tape run
        this.debug(` Tape run starting at offset ${offset}`);

        // Number of bits in this tape run
        this.debug(`  run width ${printwidth}px (${printwidth / 8} bytes)`);

        // Construct rasters
        for (let y = height - 1; y >= 0 ; y--) {
          const raster = new Uint8Array((padding + this.status.printable_width_px) / 8);
          raster.fill(0);
          let raster_byte = 0;
          let empty = true;

          // Pack leading padding
          let x;
          let bit = 7;
          for (x = 0; x < padding; x++) {
            // Pack 8 pixels into a byte
            if (--bit < 0) {
              raster_byte++;
              bit = 7;
            }
          }

          // Pack bits from the image
          let byte = 0; // byte currently being packed
          for (x = 0; x < printwidth; x++) {
            if (getPixel(offset + x, y) === 0) {
              // Fill byte from MSB
              byte |= (1 << bit);
              empty = false;
            }

            if (--bit < 0) { // byte is full
              raster[raster_byte++] = byte;
              byte = 0;
              bit = 7;
            }
          }
          raster[raster_byte++] = byte;

          //this.debug(`  raster ${raster.map(b => Number(b).toString(16)).join(" ")}`);
          if (empty) {
            // Some docs say this only works in compressed mode
            buffer.push(EMPTY_RASTER);
          } else {
            // Note: The PT1230PC can't print more than 64
            // bits in a raster, so the second byte will
            // always be 0 for this device.
            buffer.push(SEND_RASTER,
                        raster.length % 256,
                        Math.floor(raster.length / 256));
            buffer.push(...raster);
          }
        }
        // Increment for next tape length
        offset += printwidth;
        buffer.push(PRINT_NOFEED);
      }
      return this.write(buffer);
    });
  }
}

export { PTouch, Status }
