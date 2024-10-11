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

/**
 * Schema for a status report from the printer. Each byte in the
 * 32 byte report is mapped to a field in an analysis structure.
 * 'name' gives the field name.
 * 'expect' gives the expected value of the byte (what it always is)
 * 'bits' gives the interpretation of specific bits in the byte
 * 'values' gives the interpretation of certain values the byte can take
 */
const STATUS_BYTES = [
  { /*00*/ name: 'Print head mark', expect: 0x80 },
  { /*01*/ name: 'Print head size' }, // print head size?
  { /*02*/ name: 'Brother code', expect: 0x42 },
  { /*03*/ name: 'Series code', expect: 0x30 },
  { /*04*/ name: 'Model',
    values: {
      // Obtained from Brother documents. It's anyone's guess what
      // goes in the gaps
      0x4A: "PT500PC",
      0x59: "PT1230PC",
      0x64: "PT-H500",
      0x65: "PT-E500",
      0x67: "PT-P700",
      0x69: "PT-P900W",
      0x70: "PT-P950NW",
      0x71: "PT-P900",
      0x78: "PT-P910BT"
    }
  },
  { /*05*/ name: 'Country code', expect: 0x30 },
  { /*06*/ name: 'Reserved06' },
  { /*07*/ name: 'Reserved07' },
  { /*08*/ name: 'Error information 1',
    bits: [
      'No media', 'End of media', 'Cutter jam', 'Weak batteries',
      'Printer in use', 'Unused', 'High-voltage adapter', 'Unused'
    ]
  },
  { /*09*/ name: 'Error information 2',
    bits: [
      'Replace media', 'Expansion buffer full', 'Comms error', 'Buffer full',
      'Cover open', 'Overheating', 'Black marking not detected', 'System error'
    ]
  },
  { /*10*/ name: 'Media width' },
  { /*11*/ name: 'Media type',
    values: {
      0x00: 'Unknown', 0x01: 'Laminated', 0x02: "Lettering",
      0x03: 'Non-laminated', 0x04: 'Fabric', 0x08: "AV", 0x09: "HG",
      0x11: 'Heat shrink 2:1', 0x13: "Fle", 0x14: "Flexible ID", 0x15: "Satin",
      0x17: 'Heat shrink 3:1', 0xFF: 'Incompatible tape'
    }
  },
  { /*12*/ name: 'Number of colors', expect: 0 },
  { /*13*/ name: 'Fonts', expect: 0 },
  { /*14*/ name: 'Japanese Fonts', expect: 0 },
  { /*15*/ name: 'Mode',
    bits: [
      'reserved', 'reserved', 'not used', 'not used',
      'not used', 'not used', 'Auto cut', 'Mirror printing'
    ]},
  /* The rest are not reported by the PT1230 (always 0) */
  { /*16*/ name: 'Density' },
  { /*17*/ name: 'Media length' },
  { /*18*/ name: 'Status type',
    values: {
      0x00: "Reply to status request",
      0x01: "Printing complete",
      0x02: "Error occurred",
      0x06: "Phase change"
    }
  },
  { /*19*/ name: 'Phase type',
    values: {
      0x00: "Receiving", 0x01: "Printing"
    }
  },
  { /*20*/ name: 'Phase number HO', expect: 0 },
  { /*21*/ name: 'Phase number LO' },
  { /*22*/ name: 'Notification number' },
  { /*23*/ name: 'Expansion area' },
  { /*24*/ name: 'Tape color information' },
  { /*25*/ name: 'Text color information' },
  { /*26*/ name: 'Hardware settings 0' },
  { /*27*/ name: 'Hardware settings 1' },
  { /*28*/ name: 'Hardware settings 2' },
  { /*29*/ name: 'Hardware settings 3' },
  { /*30*/ name: 'Reserved30' },
  { /*31*/ name: 'Reserved31' }
];

class PTouch {

  /**
   * Write to the device. Only defined so that a test can subclass and override
   * this method.
   * @param {Buffer|Array} buffer buffer to write
   * @return {Promise.<undefined>} promise that resolves to undefined
   * @protected
   */
  write(buff) {
    const b = (buff instanceof Buffer) ? buff : Buffer.from(buff);
    this.debug("->", b);
    return Fs.writeFile(this.device, b);
  }

  /**
   * Read from the device. Only defined so that a test can subclass and override
   * this method.
   * @return {Promise.<Buffer>} promise that resolves to a buffer
   * @protected
   */
  read() {
    return Fs.readFile(this.device)
    .then(data => {
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
     */
    this.debug = params.debug || function() {};

    /**
     * Pathname of the output device e.g. /dev/usb/lp0
     */
    this.device = params.device;

    if (!this.device) throw new Error("No device specified");

    /**
     * Width of a single pixel in mm
     * @member {number}
     */
    this.pixel_width_mm = 0;

    /**
     * Number of mm of tape to emit to cause an eject
     * @member {number}
     */
    this.eject_mm = 0;

    /**
     * Number of rasters to emit to cause an eject
     * @member {number}
     */
    this.eject_px = 0;

    /**
     * Number of pixels in a raster line
     * @member {number}
     */
    this.raster_px = 0;

    /**
     * Width of a raster line in mm
     * @member {number}
     */
    this.raster_mm = 0;

    /**
     * Number of printable pixels at the centre of each raster line.
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
     * width of tape media in px
     * @member {number}
     */
    this.media_width_px = 0;

    /**
     * width of tape media in mm
     * @member {number}
     */
    this.media_width_mm = 0;

    /**
     * Once a response has been received from the printer, this will
     * change to "Receiving" (when the device is in a passive receive state),
     * "Printing", or "Feeding".
     * @private
     */
    this.phase = "Initialisation";

    this.initialised = false;
  }

  /**
   * Disconnect from the printer
   */
  close() {
    if (this.initialised && this.fd) {
      this.fd.close();
    }
    this.initialised = this.fd = undefined;
  }

  /**
   * Reset the printer, request a status report and analyse it.
   * @private
   */
  getStatusReport() {
    return this.fd.write(Buffer.from(
      [ ...INVALIDATE, ...INITIALISE_CLEAR, ...SEND_STATUS ]))
    .then(res => {
      this.debug("WROTE", res.bytesWritten);
      return this.fd.read();
    })
    .then(res => {
      if (res.bytesRead > 0) {
        this.debug("READ", res.bytesRead, res.buffer[0]);
        if (res.buffer[0] === 0x80)
          return this.analyseStatusReport(res.buffer);
      }
      // Recursively try again. Shouldn't take more than a
      // couple of tries.
      return this.getStatusReport();
    });
  }

  /**
   * Promise to initialise the device by clearing the device down,
   * requesting a status report from the device, and waiting for
   * asynchronous initialisation.
   * @return {Promise.<undefined>} Promise that resolves to undefined
   * @private
   */
  initialise() {
    if (this.initialised)
      return Promise.resolve();

    return Fs.open(this.device, "r+")
    .then(fd => {
      this.fd = fd;
      return this.getStatusReport();
    })
    .then(() => {
      this.debug(`PTouch: Printable width is ${this.printable_width_px}px`,
                 `(${this.printable_width_mm}mm)`);
    });
  }

  /**
   * Use the STATUS_BYTES to make sense of the status report
   * @param {Buffer} the buffer containing the status
   * @private
   */
  analyseStatusReport(reply) {
    console.debug("PTouch: ANALYSING status");
    const report = {};
    let idx = 0;
    for (const sb of STATUS_BYTES) {
      let r = reply[idx++];
      if (typeof sb.expect !== "undefined") {
        if (r !== sb.expect)
          throw new Error(`Unexpected ${sb.name} in status; got ${r} but expected ${sb.expect}`);
        report[sb.name] = r;
      }
      else if (typeof sb.bits !== "undefined") {
        let mask = 1;
        const set = []; // strings
        for (let b = 0; b < 8; b++) {
          if ((r & (1 << b)) === 0)
            continue;
          set.push(sb.bits[b]);
          mask *= 2;
        }
        report[sb.name] = set.join("|");
      }
      else if (typeof sb.values !== "undefined") {
        report[sb.name] = sb.values[r];
      } else {
        report[sb.name] = r;
      }
    }

    // Use the report to determine device dimensions
    this.model = report.Model;
    this.media_width_mm = report['Media width'];
    this.phase = report['Phase Type'];
    if (this.phase === "Receiving" && report['Phase number LO'] === 1)
      this.phase = "Feeding";

    if (this.model === "PT1230PC") {

      // Width of a single raster, must be 18mm even though the PT1230
      // only supports up to 12mm tape
      this.raster_mm = 18;

      // Number of pixels in a single raster
      this.raster_px = 128;

      // max no of pins available
      this.printable_width_px = 64;

		  // Distance the tape has to be rolled before the cutter is aligned
		  // to the start of the print run
		  this.eject_mm = 25;
    } else {
      throw new Error(`Don't know enough about model ${this.model}`);
    }

    // Number of rasters to eject raster_mm of tape
	  this.eject_px = Math.floor(
      this.raster_px * this.eject_mm / (this.raster_mm) + 0.5);
	
    // pixel_width_mm - width of a single pixel in mm
    this.pixel_width_mm = this.raster_mm / this.raster_px;

    // Outside width of tape
    this.media_width_px = this.media_width_mm / this.pixel_width_mm;

    this.debug(
      `PTouch: Tape is ${this.media_width_px}px (${this.media_width_mm}mm) wide`);

    this.debug(`A raster is ${this.raster_px}px (${this.raster_mm}mm),`,
               `max printable width is ${this.printable_width_px}px`,
               `(${this.printable_width_px * this.pixel_width_mm}mm)`);
    
    if (this.media_width_px < this.printable_width_px) {
      this.printable_width_px =
      this.media_width_mm / this.pixel_width_mm;
      this.debug(`Tape is narrower than printable area.`,
                 `Reducing printable area to `
                 + `${this.printable_width_px}px for `
                 + `${this.media_width_mm}mm media`);
    }
    this.printable_width_mm = 
    this.printable_width_px * this.pixel_width_mm;

    this.initialised = true;
  }

  /**
   * Promise to Eject the tape
   * @return {Promise} Promise that resolves to undefined
   */
  eject() {
    this.debug(`PTouch: Eject ${this.eject_px} rasters`);
    const buff = Buffer.alloc(this.eject_px + 1, EMPTY_RASTER);
    buff[buff.length - 1] = PRINT_NOFEED;
    return this.write(buff);
  }

  /**
   * Format and print a monochrome image held in a one-bit-per-pixel buffer.
   * The image must be small enough that it will fit.
   * @param {Buffer} image the image buffer (raw pixel data)
   * @param {number} width width of the image
   * @param {number} height height of the image
   * @param {number} bpp bytes per pixel, defaults to 4
   * @return {Promise} Promise that resolves to undefined
   */
  printImage(image, width, height, bpp = 4) {

    /**
     * Read a pixel from the image, (crudely) converting to b&w as we go.
     * @param {number} x x coordinate
     * @param {number} y y coordinate
     * @return {number} 1 if the pixel is black, 0 if it's white
     */
    function getPixel(x, y) {
      // Process the image data to monochrome 1-bit per pixel
      const offset = (y * width + x) * bpp;
      switch (bpp) {
        // RGB no A 
      case 3: return (image[offset] + image[offset + 1]
                      + image[offset + 2] < 3*255) ? 0 : 1;
      // RGBA any A less than 51 will be treated as transparent
      case 4: return image[offset + 3] > 50 ? 0 : 1;
      default: throw new Error(`BPP ${bpp} not supported`);
      }
    }

    // Promise to initialise, if needed
    return this.initialise()
    .then(() => {
      let s = "";
      for(let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++)
          s += getPixel(x, y) === 0 ? "X" : ".";
        s += "\n";
      }
      this.debug(`PTouch: *** Printing image w=${width} h=${height}\n${s}`);

      // Each raster is padded by blank bits to centre the image
      const padding = (this.raster_px - this.printable_width_px) / 2;
      this.debug(`\tStart padding ${padding}px (${padding / 8} bytes)`);

      // The print buffer
      const buffer = [ ...COMPRESSION, 0, // uncompressed
                       ...SET_RASTER_MODE, 1,
                       ...FEED_AMOUNT, 0, 0 ];

      this.debug(` Requires ${Math.ceil(width / this.printable_width_px)} tape runs`);

      // Split into tape lengths, each max printable_width_px wide
      let offset = 0;
      while (offset < width) {
        let printwidth = this.printable_width_px;
        if (offset + printwidth > width) {
          printwidth = width - offset;
        }

        // Offset to start of raster info for this tape run
        this.debug(` Tape run starting at offset ${offset}`);

        // Number of bits in this tape run
        this.debug(`  run width ${printwidth}px (${printwidth / 8} bytes)`);

        // Construct rasters
        for (let y = height - 1; y >= 0 ; y--) {
          const raster = new Uint8Array((padding + this.printable_width_px) / 8);
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
            //console.debug(`  ${raster.map(v => Number(v).toString(16)).join(" ")}`);
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

export { PTouch }
    
