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
 *
 * If the printer is initialised with a device type ending with "_F",
 * then a default status block will be used and the device will be
 * treated as write-only.
 */

import fs from "node:fs";
const Fs = fs.promises;
import assert from "assert";
import { PrinterStatus } from "./PrinterStatus.js";

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
   * @param {String} params.model printer model name (e.g. "PT1230"). If the
   * name ends with "_F", the device will be treated as a write-only
   * file e.g. "PT1230_F".
   * @param {function?} params.debug function e.g. console.debug
   */
  constructor(params = {}) {

    /**
     * Report function
     * @member {function}
     */
    /* c8 ignore next */
    this.debug = params.debug ?? function() {};

    /**
     * Pathname of the output device e.g. /dev/usb/lp0
     * @member {string}
     */
    this.device = params.device;

    if (!this.device) throw new Error("No device specified");

    /**
     * Device model
     */
    this.model = params.model
    ? PrinterStatus.getModelByName(params.model)
    : PrinterStatus.getModelByName("PT1230");
    if (!this.model)
      throw Error(`Bad model "${params.model}"`);

    /**
     * Current printer status will be read from the printer during
     * initialise(). This is just a default which will be used
     * if the printer can't be talked to.
     * @member {PrinterStatus}
     */
    this.status = PrinterStatus.from(this.model.defaultStatus);
    this.status.model = this.model.name;

    this.debug(`Printer type ${this.model.name}`);
    /**
     * Flag indicating if the device can be interrogated for status
     * information.
     */
    this.write_only = params.model
    ? params.model.endsWith("_F")
    : false;

    /**
     * Flag to indicate successult device initialisation
     * @private
     */
    this.initialised = false;
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
   * Promise to reset the printer to it's default state (whatever that may be)
   * @return {Promise.<this>} promise resolving to this
   */
  reset() {
    return this.write([ ...INVALIDATE, ...INITIALISE_CLEAR ])
    .then(() => this);
  }

  /**
   * Promise to request a status report from the printer and analyse it.
   * The status report will be cached in this.status
   * @return {Promise.<StatusReport>} promise resolving to the status report
   * @private
   */
  getStatusReport() {
    if (this.write_only)
      return Promise.resolve(this.status);

    return this.write(SEND_STATUS)
    .then(res => {
      //this.debug("WROTE", res.bytesWritten);
      return this.read();
    })
    .then(res => {
      if (res.bytesRead > 0) {
        //this.debug("READ", res.bytesRead, res.buffer[0]);
        // Check for print head mark
        if (res.buffer[0] === 0x80)
          return this.status = new PrinterStatus(res.buffer, this.debug);
      }
      // Recursively try again. Shouldn't take more than a
      // couple of tries. If it does then it'll blow up, but
      // that's OK.
      return this.getStatusReport();
    });
  }

  /**
   * Promise to initialise the device.
   * @return {Promise.<this>} Promise that resolves to this when
   * the printer has been initialised.
   */
  initialise() {
    if (this.initialised)
      return Promise.resolve(this);

    const mode = this.write_only ? "w" : "r+";

    return Fs.open(this.device, mode)
    .then(fd => {
      this.fd = fd;
      return this.reset();
    })
    .then(() => this.write_only ? Promise.resolve(this) : this.getStatusReport())
    .then(() => {
      this.initialised = true;
      return this;
    });
  }

  /**
   * Promise to Eject the tape
   * @return {Promise} Promise that resolves to undefined
   */
  eject() {
    this.debug(`PTouch: Eject ${this.status.eject_px} rasters`);
    const buff = Buffer.alloc(this.status.eject_px + 1, EMPTY_RASTER);
    buff[buff.length - 1] = PRINT_NOFEED;
    return this.write(buff);
  }

  /**
   * Format and print a monochrome image held in an RGBA byte buffer.
   * @param {Buffer} image the image buffer (raw pixel data)
   * @param {number} width width of the image
   * @param {number} height height of the image
   * @return {Promise} Promise that resolves to undefined
   */
  printImage(image, width, height) {

    /**
     * Read a pixel from the image.
     * @param {number} x x coordinate
     * @param {number} y y coordinate
     * @return {boolean} true if the pixel is black
     */
    function isBlack(x, y) {
      // The UI converts the image to 1 bit per pixel, though this is
      // encoded in RGBA with A being 255 for black and 0 for white.
      const offset = (y * width + x) * 4;
      return image[offset + 3] > 0;
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
        const byte_count = (padding + this.status.printable_width_px) / 8;
        const raster = new Uint8Array(byte_count);
        for (let y = height - 1; y >= 0 ; y--) {
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
            if (isBlack(offset + x, y)) {
              // Fill byte from MSB
              byte |= (1 << bit);
              empty = false;
            }

            if (--bit < 0) { // byte is full
              raster[raster_byte++] = byte;
              byte = 0;
              //bit = 7; // no need
            }
          }
          raster[raster_byte++] = byte;

          if (empty) {
            // Some docs say this only works in compressed mode
            this.debug("  empty raster");

            buffer.push(EMPTY_RASTER);
          } else {
            const da = Array.from(raster);
            this.debug(`  raster ${da.map(b => Number(b).toString(16).padStart(2, "0"))}`);
            buffer.push(SEND_RASTER,
                        byte_count % 256,
                        Math.floor(byte_count / 256));
            buffer.push(...raster);
          }
        }
        // Increment for next tape length
        offset += printwidth;
        // Despite what it says on the tin, print nofeed feeds the tape on the PT1230
        //buffer.push(PRINT_NOFEED);
      }
      return this.write(buffer);
    });
  }
}

export { PTouch }
