/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node */
/* global Buffer */

/**
 * Support for Brother P-Touch printers, only tested with PT1230PC but
 * should be a suitable basis for supporting other models.
 * See the "references" folder for details of the protocol for similar devices.
 * Also https://github.com/cbdevnet/pt1230
 */
import { promises as Fs } from "node:fs";
import { EventEmitter } from "node:events";

import { PTouchStatus } from "./PTouchStatus.js";
import { Model, Models } from "./Models.js";
import { fromBinary } from "./Readable.js"; // debugging

/**
 * Commands used to control a PTouch printer. See the references folder.
 */
const Commands = {
  // Send to clear the print buffer. Can't find any documentation as
  // to how large the print buffer is, but sending 200 of these seems
  // to be the norm.
  INVALIDATE: 0x00,

  // Initialise the device.
  INITIALISE_CLEAR: [ 0x1B/*ESC*/, 0x40/*@*/ ],

  // Status request, response is 32 bytes.
  SEND_STATUS: [ 0x1B/*ESC*/, 0x69/*i*/, 0x53/*S*/ ],

  // PT500 doc says "sets printer to raster mode" for
  // 0x1B 0x69 0x61 0x01 and doesn't mention 0x1B 0x69 0x52
  //(SET_TRANSFER_MODE)
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
  // Doc isn't clear what this means; possible feed amount for PRINT_FEED?
  FEED_AMOUNT: [ 0x1B/*ESC*/, 0x69/*i*/, 0x64/*d*/ ],

  // Not used
  PAGE_NUMBER: [ 0x1B/*ESC*/, 0x69/*i*/, 0x41/*A*/ ],

  // Not used
  AUTO_STATUS: [ 0x1B/*ESC*/, 0x69/*i*/, 0x21/*!*/ ],

  // Follow with 1 byte, 0 = ESC/P, 1 = raster. However the PT1230
  // does nothing when I send it ESC/P commands, so I have to assume
  // it isn't supported.
  SET_TRANSFER_MODE: [ 0x1B/*ESC*/, 0x69/*i*/, 0x52/*R*/ ],

  // Print with feeding
  // Not used, mainly because it wastes so much tape. Possibly
  // controllable with FEED_AMOUNT?
  PRINT_FEED: 0x1A/*SUB/Ctrl+Z*/,

  // Don't feed the tape
  PRINT_NOFEED: 0x0C/*FF*/,

  RASTER_DATA: 0x47/*G*/, // SMELL: PTP700 document says 'g' 0x67?

  // PTP900 manual says this is esc/p mode only! But it works, so...
  EMPTY_RASTER: 0x5A/*Z*/
};

/**
 * Interface to a Brother P-Touch printer.
 * To avoid having to write a device driver (or farting about with
 * usb), the comms with the printer are done via the /dev/usb/lp0
 * interface. However it also supports the concept of a "write only"
 * device that allows for undirectional comms and saving to files for
 * later cat-ing to the printer.
 */
class PTouch extends EventEmitter {

  /**
   * Write to the device.
   * @param {Buffer|Array} buff data to write
   * @return {Promise.<undefined>} promise that resolves to undefined
   * @private
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
   * @private
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
     * Reporting function
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
     * @member {PTouchStatus}
     */
    this.status = PTouchStatus.from(this.model.defaultStatus);
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
   * Promise to initialise the device. Opens the device and sends
   * commands to reset it to a known state. If the device is read-write,
   * requests and analyses a status report.
   * @return {Promise} Promise that resolves to undefined when
   * the printer has been initialised.
   */
  initialise() {
    if (this.initialised)
      return Promise.resolve(this);

    const mode = this.write_only ? "w" : "r+";

    return Fs.open(this.device, mode)
    .then(fd => {
      this.fd = fd;
      // Reset the printer to a known state
      const inval = new Uint8Array(200);
      inval.fill(Commands.INVALIDATE);
      return this.write([
        ...inval,
        Commands.INITIALISE_CLEAR,
        // Docs don't say what the initial state is.
        // Try to be sure.
        ...Commands.COMPRESSION, 0, // uncompressed
        ...Commands.SET_TRANSFER_MODE, 1, // raster
        ...Commands.FEED_AMOUNT, 64, 0 // 64 dots (guess)
      ]);
    })
    .then(() => {
      if (this.write_only) {
        this.initialised = true;
        this.debug("PTouch: write-only initialised");
        return undefined;
      }

      // Return a promise that will resolve when the printer has
      // responded to an initial SEND_STATUS
      return new Promise(resolve => {
        // Set up a one-time handler for the status report
        this.once(PTouchStatus.UPDATE_EVENT, state => {
          this.initialised = true;
          this.debug(`PTouch: read-write initialised. ${state.phase}`);
          resolve();
        });
        // Start polling
        this.pollStatus();
        this.debug("PTouch: polling started");
        // Request a first status report. This will be handled
        // by the .once, above
        this.write(Commands.SEND_STATUS);
      });
    });
  }

  /**
   * Promise to eject the tape. This is done by printing empty
   * rasters, rather than using PRINT_FEED, as it's not clear how
   * to control it (though FEED_AMOUNT/PRINT_FEED look likely)
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
   * When we first start polling, we prime the printer to send a first
   * status block. Subsequent blocks will come as a result of printing
   * operations.
   * @private
   */
  pollStatus() {

    this.read()
    .then(reply => {
      // Suck up 32 byte blocks that begin with a PRINT_HEAD_MARK
      if (reply.bytesRead > 0) {
        let i = 0;
        while (i < reply.bytesRead) {
          // Are we in the process of assembling a status block?
          if (this.statusBlock.length > 0) {
            this.statusBlock.push(reply.buffer[i]);
            // Is the status block complete?
            if (this.statusBlock.length === 32) {
              this.status = new PTouchStatus(this.statusBlock, this.debug);
              this.statusBlock = [];
              this.emit(PTouchStatus.UPDATE_EVENT, this.status);
              this.debug("PTouch: update event emitted", this.status);
            }
          } else
            // Is this the start of a status block?
            if (reply.buffer[i] === PTouchStatus.PRINT_HEAD_MARK) {
              this.statusBlock = [ reply.buffer[i] ];
            }
          // Otherwise ignore this byte
          i++;
        }
      }
      // Poll again in 1/5s
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

    // Wait for the "printed" event. Not sure if this is better than
    // status_type==PHASE_CHANGED + phase==READY
    return new Promise(resolve =>
      this.once(PTouchStatus.Type.PRINTED, status => {
        this.debug(`PTouch: Printing complete ${status}`);
        resolve();
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

      this.debug(`\tRequires ${Math.ceil(width / this.status.printable_width_px)} tape runs`);

      // Split into tape lengths, each max printable_width_px wide
      let offset = 0, x, bit;
      while (offset < width) {
        let printwidth = this.status.printable_width_px;
        if (offset + printwidth > width) {
          printwidth = width - offset;
        }

        // Offset to start of raster info for this tape run
        this.debug(`\tTape run starting at offset ${offset}`);

        // Number of bits in this tape run
        this.debug(`\t\tRun width ${printwidth}px (${printwidth / 8} bytes)`);

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
