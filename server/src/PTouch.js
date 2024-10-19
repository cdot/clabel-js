/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node */
/* global Buffer */

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

import { promises as Fs } from "node:fs";
import { EventEmitter } from "node:events";

import { PrinterStatus } from "./PrinterStatus.js";
import { Model, Models } from "./Models.js";
import { fromBinary } from "./Readable.js"; // debugging

/**
 * Commands used to control a PTouch printer. See the references.
 */
const Commands = {
  // Send to clear the print buffer
  INVALIDATE: 0x00,

  // Also used to cancel printing
  INITIALISE_CLEAR: [ 0x1B/*ESC*/, 0x40/*@*/ ],

  // Status request, response is analysed below
  SEND_STATUS: [ 0x1B/*ESC*/, 0x69/*i*/, 0x53/*S*/ ],

  // PT500 doc says "sets printer to raster mode" for
  // 0x1B 0x69 0x61 0x01 and doesn't mention SET_RASTER_MODE
  // 0x1B 0x69 0x61 0x09 is ESC/P mode
  // Not used
  DYNAMIC_COMMAND_MODE: [ 0x1B/*ESC*/, 0x69/*i*/, 0x61/*a*/ ],

  // Not used
  PRINT_INFORMATION: [ 0x1B/*ESC*/, 0x69/*i*/, 0x7A/*z*/ ],

  // Not used
  MODE: [ 0x1B/*ESC*/, 0x69/*i*/, 0x4D/*M*/ ],

  // Follow with 1 byte 0=uncompressed, 2=TIFF
  COMPRESSION: [ 0x4D/*M*/ ],

  // Not used
  ADVANCED_MODE: [ 0x1B/*ESC*/, 0x69/*i*/, 0x4B/*K*/ ],

  // Follow with 2 bytes, b1+b2*256 dots
  // https://support.brother.com/g/b/spec.aspx?c=gb&lang=en&prod=1230euk says
  // "Tape margin settings Large (24.4mm) / Small (4mm)"
  // Not used
  FEED_AMOUNT: [ 0x1B/*ESC*/, 0x69/*i*/, 0x64/*d*/ ],

  // Not used
  PAGE_NUMBER: [ 0x1B/*ESC*/, 0x69/*i*/, 0x41/*A*/ ],

  // Not used
  AUTO_STATUS: [ 0x1B/*ESC*/, 0x69/*i*/, 0x21/*!*/ ],

  SET_TRANSFER_MODE: [ 0x1B/*ESC*/, 0x69/*i*/, 0x52/*R*/ ],

  // Print with feeding
  // Not used
  PRINT_FEED: 0x1A/*SUB/Ctrl+Z*/,

  // Don't feed the tape
  PRINT_NOFEED: 0x0C/*FF*/,

  RASTER_DATA: 0x47/*G*/, // SMELL: PTP700 document says 'g' 0x67?

  // PTP900 manual says this is raster mode only! But it works, so...
  EMPTY_RASTER: 0x5A/*Z*/
};

class PTouch extends EventEmitter {

  /**
   * Event emitted by the printer when it detects a status change
   */
  static PRINTER_STATE_CHANGE = "StatusChanged";

  /**
   * Write to the device.
   * @param {Buffer|Array} buff data to write
   * @return {Promise.<undefined>} promise that resolves to undefined
   * @protected
   */
  write(buff) {
    const b = (buff instanceof Buffer) ? buff : Buffer.from(buff);
    //this.debug("->", b);
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
      //this.debug("<-", data);
      return data;
    });
  }

  /**
   * @param {object} params setup parameters
   * @param {String} params.device device name (e.g. /dev/usb/lp0)
   * @param {Model} params.model printer model.
   * @param {function?} params.debug function e.g. console.debug
   */
  constructor(params = {}) {

    super();

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
    if (params.model instanceof Model)
      this.model = params.model;
    else if (typeof params.model === "string")
      this.model = Models.getModelByName(params.model);
    else
      this.model = Models.default();

    /**
     * Current printer status will be read from the printer during
     * initialise(). This is just a default which will be used
     * if the printer can't be talked to.
     * @member {PrinterStatus}
     */
    this.status = PrinterStatus.from(this.model.defaultStatus);
    this.status.model = this.model.name;

    console.log(`Printer type ${this.model.name}`);

    /**
     * Flag indicating if the device can be interrogated for status
     * information.
     */
    this.write_only = params.write_only;

    /**
     * Flag to indicate successult device initialisation
     * @private
     */
    this.initialised = false;

    /**
     * @private
     */
    this.statusBlock = [];
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
    const buff = new Uint8Array(200);
    buff.fill(Commands.INVALIDATE);
    buff[buff.length - 1] = Commands.INITIALISE_CLEAR;
    return this.write(buff)
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

    this.debug("Asking for status");
    return this.write(Commands.SEND_STATUS);
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
    // start polling for status changes
    .then(() => this.pollStatus())
    // Force a status report
    .then(() => this.write(Commands.SEND_STATUS))
    .then(() => new Promise(resolve => {
      this.once(PTouch.PRINTER_STATE_CHANGE, state => {
        const buffer = [ ...Commands.COMPRESSION, 0, // uncompressed
                         ...Commands.SET_TRANSFER_MODE, 1 // raster
                       ];
        this.initialised = true;
        resolve(this.write(buffer));
      });
    }));
  }

  /**
   * Promise to Eject the tape. This is done by printing empty
   * rasters, rather than using PRINT_FEED, as the latter wastes
   * too much tape and I can't work out how to control it.
   * @return {Promise} Promise that resolves to undefined
   */
  eject() {
    this.debug(`PTouch: Eject ${this.status.eject_px} rasters`);
    const buff = Buffer.alloc(this.status.eject_px + 1, Commands.EMPTY_RASTER);
    buff[buff.length - 1] = Commands.PRINT_NOFEED;
    return this.write(buff);
  }

  /**
   * The only thing (of interest) that ever comes from the printer after a
   * print command has been sent is a sequence of status blocks,
   * each 32 bytes. Whenever we get a status block, we raise a "Status"
   * event, passing the new status block.
   * @private
   */
  pollStatus(started) {
    if (this.write_only)
      return;

    if (!started)
      this.debug("Started polling for status updates");
    this.read()
    .then(reply => {
      if (reply.bytesRead > 0) {
        let i = 0;
        while (i < reply.bytesRead) {
          if (this.statusBlock.length > 0) {
            this.statusBlock.push(reply.buffer[i]);
            if (this.statusBlock.length === 32) {
              this.status = new PrinterStatus(this.statusBlock, this.debug);
              this.statusBlock = [];
              this.emit(PTouch.PRINTER_STATE_CHANGE, this.status);
            }
          } else if (reply.buffer[i] !== 0) {
            this.readingStatus = true;
            this.statusBlock = [ reply.buffer[i] ];
          }
          i++;
        }
      }
      setTimeout(() => this.pollStatus(true), 200);
    });
  }

  /**
   * Wait for the printer status to switch to "Printing complete"
   * @return {Promise} promise that resolves when status "Printing complete"
   * has been seen.
   */
  awaitPrinted() {
    if (this.write_only)
      return Promise.resolve();

    return new Promise(resolve => this.on("Status", to =>
      {
        if (to.status_type === "Printing complete") {
          this.debug("Saw Printing complete");
          this.removeAllListeners("Status");
          resolve();
        }
        console.error(to);
      }));
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
      const buffer = [];

      this.debug(` Requires ${Math.ceil(width / this.status.printable_width_px)} tape runs`);

      // Split into tape lengths, each max printable_width_px wide
      let offset = 0, x, bit;
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
          bit = 7;
          for (x = 0; x < padding; x++) {
            // Pack 8 pixels into a byte
            if (--bit < 0) {
              raster_byte++;
              bit = 7;
            }
          }

          //const debugBM = [];
          // Pack bits from the image
          let byte = 0; // byte currently being packed
          for (x = 0; x < printwidth; x++) {
            if (isBlack(offset + x, y)) {
              // Fill byte from MSB
              byte = byte | (1 << bit);
              empty = false;
              //debugBM.push(`X${byte}`);
            }// else debugBM.push(".");

            if (--bit < 0) { // byte is full
              raster[raster_byte++] = byte;
              byte = 0;
              bit = 7;
            }
          }
          raster[raster_byte++] = byte;
          //this.debug(debugBM.join(""));
          if (empty) {
            buffer.push(Commands.EMPTY_RASTER);
          } else {
            buffer.push(Commands.RASTER_DATA,
                        byte_count % 256,
                        Math.floor(byte_count / 256));
            buffer.push(...raster);
          }
        }
        // Increment for next tape length
        offset += printwidth;

        // push the label gap of empty rasters. Without this,
        // the printer loses several rasters off the end of the
        // print.
        for (let i = 0; i < this.status.label_gap_px; i++)
          buffer.push(Commands.EMPTY_RASTER);

        buffer.push(Commands.PRINT_NOFEED);
      }
      console.log(fromBinary(buffer).join("\n"));
      return this.write(buffer);
    });
  }
}

export { PTouch }
