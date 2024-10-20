/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node */

import { Models } from "./Models.js";

/**
 * An object giving the current status of the printer.
 */
class PTouchStatus {

  /**
   * Event emitted whenever a status report has been received from the
   * printer. The PTouchSTatus is passed.
   */
  static UPDATE_EVENT = "PTOUCH_UPDATE";

  /**
   * Byte marker for the beginning of a raw status block read
   * from the printer
   * @property {number}
   */
  static PRINT_HEAD_MARK = 0x80;

  /**
   * Interpretation of bits in error_information
   * @private
   */
  static ERROR_BITS = Object.freeze([
    'No media', 'End of media', 'Cutter jam', 'Weak batteries',
    'Printer in use', 'Unused', 'High-voltage adapter', 'Unused',
    'Replace media', 'Expansion buffer full', 'Comms error', 'Buffer full',
    'Cover open', 'Overheating', 'Black marking not detected', 'System error'
  ]);

  /**
   * Types of media, lookup values for media_type
   */
  static MEDIA_TYPES = Object.freeze({
    0x01: 'Laminated', 0x02: "Lettering", 0x03: 'Non-laminated',
    0x04: 'Fabric', 0x08: "AV",  0x09: "HG", 0x11: 'Heat shrink 2:1',
    0x13: "Fle", 0x14: "Flexible ID", 0x15: "Satin",
    0x17: 'Heat shrink 3:1', 0xFF: 'Incompatible tape'
  });

  /**
   * Values for status_type, the type of the status report
   * @readonly
   * @typedef Type
   * @enum {number}
   * @property {number} REPLY reply to status request
   * @property {number} PRINTED report generated when printing completed
   * @property {number} ERROR report generated because of error
   * @property {number} PHASE_CHANGED report generated because phase changed
   */
  static Type = Object.freeze({
    0: "REPLY",
    1: "PRINTED",
    2: "ERROR",
    6: "PHASE_CHANGED"
  });

  /**
   * Phase the printer is now in.
   * @readonly
   * @typedef Phase
   * @enum {number}
   * @property {number} UNKNOWN don't know, probably READY
   * @property {number} READY ready to accept print data
   * @property {number} PRINTING currently printing
   * @property {number} FEEDING currently feeding
   */
  static Phase = Object.freeze({
    0: "READY",
    1: "PRINTING",
    2: "FEEDING"
  });

  /**
   * Derive shortcut dimensions from a partially-filled status report.
   * @param {function} debug function
   * @private
   */
  deriveDimensions(debug = () => {}) {
	  this.eject_px = Math.floor(
      this.raster_px * this.eject_mm / this.raster_mm + 0.5);

	  this.pixel_width_mm = this.raster_mm / this.raster_px;

    this.media_width_px = this.media_width_mm / this.pixel_width_mm;

    debug(`Tape is ${this.media_width_px}px (${this.media_width_mm}mm) wide\n`
          + `A raster is ${this.raster_px}px (${this.raster_mm}mm)\n`
          + `Max printable width is ${this.printable_width_px}px`
          + `(${this.printable_width_px * this.pixel_width_mm}mm)`);
    
    if (this.media_width_px < this.printable_width_px) {
      this.printable_width_px =
      this.media_width_mm / this.pixel_width_mm;
      debug(`Tape is narrower than printable area. `
            + `Reducing printable area to `
            + `${this.printable_width_px}px for ${this.media_width_mm}mm media`);
    }
    this.printable_width_mm = 
    this.printable_width_px * this.pixel_width_mm;
  }

  /**
   * Parse status information from a raw buffer
   * @param {Buffer|Uint8Array} raw buffer to pase
   * @private
   */
  parseRaw(raw) {
    if (raw.length < 32) throw new Error(`PTouchStatus: Bad report length ${raw.length}`);

    if (raw[0] !== PTouchStatus.PRINT_HEAD_MARK)
      throw new Error(`PTouchStatus: Bad print head mark ${raw[0]}`);

    // raw[1] = Print head size, don't know what this is
    if (raw[2] !== 0x42) throw new Error(`PTouchStatus: Bad Brother code ${raw[2]}`);
    if (raw[3] !== 0x30) throw new Error(`PTouchStatus: Bad series code ${raw[2]}`);
    if (raw[5] !== 0x30) throw new Error(`PTouchStatus: Bad country code ${raw[3]}`);

    // Determine the printer model
    const model = Models.getModelByDeviceCode(raw[4]);
    if (!model)
      throw new Error(`PTouchStatus: Unsupported device code 0x${Number(raw[4]).toString(16)}`);

    if (model.defaultStatus)
      this.copy(model.defaultStatus);

    this.model = model.name;

    // raw[6] Reserved
    // raw[7] Reserved

    if (raw[8] !== 0 || raw[9] !== 0)
      this.error_information = (raw[8] << 8) | raw[9];

    this.media_type = raw[11];

    this.media_width_mm = raw[10];
    this.status_type = raw[18];
 
    switch (raw[19]) { // phase type. raw[20] is always 0.
    case 0: // "Editing state, receiving"
      if (raw[21] === 1)
        this.phase = 2; // FEEDING
      else
        this.phase = 0; // READY;
      break;
    case 1: // "Printing state"
      switch (raw[21]) {
      case 0x00:
        this.phase = 1; // PRINTING;
        break;
      case 0x0a:
      case 0x14: // cover open while receiving
      case 0x19:
      default:
        throw new Error(`Unsupported printing state ${raw[21]}`);
      }
      break;
    default:
      throw new Error(`Unknown phase type ${raw[19]}`);
    }

    // For completeness, other stuff from the status report which
    // will usually be all zeros.
    /*
    if (raw[12] !== 0) this.number_of_colours = raw[12];
    if (raw[13] !== 0) this.fonts = raw[13]; // Fonts
    if (raw[14] !== 0) this.japanese_fonts = raw[14]; // Japanese Fonts
    if ((raw[15] && 1) !== 0) this.mirror_printing = true;
    if ((raw[15] && 2) !== 0) this.auto_cut = true;

    if (raw[16] !== 0) this.density = raw[16];
    if (raw[17] !== 0) this.media_length = raw[17];
    if (raw[16] !== 0) this.density = raw[16];

    switch (raw[22]) {
    case 1: this.cover = "Opened"; break;
    case 2: this.cover = "Closed"; break;
    }

    if (raw[23] !== 0) this.expansion_area = raw[23];
    if (raw[24] !== 0) this.tape_color_info = raw[24];
    if (raw[25] !== 0) this.text_color_info = raw[25];
    if (raw[26] !== 0) this.hw_settings_0 = raw[26];
    if (raw[27] !== 0) this.hw_sttings_1 = raw[27];
    if (raw[28] !== 0) this.hw_settings_2 = raw[28];
    if (raw[29] !== 0) this.hw_settings_3 = raw[29];
    */
  }

  /**
   * Copy a block of status information.
   * @param {PTouchStatus|object} status to copy
   * @private
   */
  copy(status) {
    for (const key of Object.keys(this))
      this[key] = status[key];
    this.deriveDimensions();
  }

  /**
   * Construct a new status from a block of status information.
   * @param {PTouchStatus|object} status optional status to copy, pas
   * undefined to just construct a fresh object.
   * @param {function?} debug debug print function
   */
  static from(status, debug = () => {}) {
    const s = new PTouchStatus(undefined, debug);
    if (status)
      s.copy(status);
    return s;
  }

  /**
   * @param {Buffer?} raw an optional byte buffer containing a status report
   * to be parsed
   * @param {function?} debug function
   */
  constructor(raw, debug = () => {}) {
    
    /**
     * Number of mm of tape to emit to cause an eject.
     * From model defaultStatus.
     * @member {number}
     */
    this.eject_mm = 0;

    /**
     * Number of pixels in a raster line. From model defaultStatus.
     * @member {number}
     */
    this.raster_px = 0;

    /**
     * Width of a raster line in mm. From model defaultStatus.
     * @member {number}
     */
    this.raster_mm = 0;

    /**
     * Number of printable pixels at the centre of each raster line.
     * From model defaultStatus.
     * @member {number}
     */
    this.printable_width_px = 0;

    /**
     * Width in mm of the printable area.
     * Each pixel is therefore (printable_width_mm/printable_width_px)mm wide.
     * Pixels are assumed to be square.
     * From model defaultStatus.
     * @member {number}
     */
    this.printable_width_mm = 0;

    /**
     * Media type name.
     * From model defaultStatus.
     * @member {number}
     */
    this.media_type = 'Unknown';

    /**
     * Width of tape media in mm. From model defaultStatus.
     * @member {number}
     */
    this.media_width_mm = 0;

    /**
     * Number of rasters to emit to cause an eject. Derived.
     * @member {number}
     */
	  this.eject_px = 0;

    /**
     * Width of a single pixel in mm. Derived.
     * @member {number}
     */
    this.pixel_width_mm = 0;

    /**
     * Width of tape media in px. Derived.
     * @member {number}
     */
    this.media_width_px = 0;

    /**
     * Current printer phase.
     * @member {Phase}
     */
    this.phase = PTouchStatus.Phase.UNKNOWN;

    /**
     * Gives the reason the status report was generated.
     * @member {Phase}
     */
    this.status_type = PTouchStatus.Type.UNKNOWN;

    if (raw) {
      this.parseRaw(raw);
      // Use the report to determine additional dimensions
      this.deriveDimensions(debug);
    }

    // Availability/usefulness of the following status information
    // varies from printer to printer
    /*
      this.number_of_colours = undefined;
      this.fonts = undefined;
      this.japanese_fonts = undefined;
      this.mirror_printing = undefined;
      this.auto_cut = undefined;
      this.density = undefined;
      this.media_length = undefined;
      this.density = undefined;
      this.cover = undefined;
      this.expansion_area = undefined;
      this.tape_color_info = undefined;
      this.text_color_info = undefined;
      this.hw_settings_0 = undefined;
      this.hw_sttings_1 = undefined;
      this.hw_settings_2 = undefined;
      this.hw_settings_3 = undefined;
    */
  }
}

export { PTouchStatus }
