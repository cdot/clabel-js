/**
 * Model information gleaned from Brother documents and printers.
 * name: text name of the device
 * deviceCode: model code reported in status reports
 * defaultStatus: a default status block, for use when the device can't be read
 * from. This is mainly for generating model-compatible files.
 * extra: Information about printer models that can't be interrogated
 * from the printer. Could be extended with features such as auto-cut,
 * if anyone has a printer that supports that!
 */
const MODELS = [
  {
    name: "PT1230",
    deviceCode: 0x59,
    defaultStatus: {
		  // Distance the tape has to be rolled before the cutter is clear
		  // of the end of the print run (mm). We eject by printing empty
      // rasters, as PRINT_FEED wastes far too much tape.
      eject_mm: 20,
      // Number of pixels in a single raster
      raster_px: 128,
      // Width of a single raster, must be 18mm even though the PT1230
      // only supports up to 12mm tape.
      raster_mm: 18,
      // Number of pins available. These are in the middle of a raster,
      // so a single raster sent to the printer will have 4 pad bytes
      // before and after the actual printable raster data.
      printable_width_px: 64,
      // 9mm printable width, not possible to print full width
      printable_width_mm: 9,
      // Standard tape
      media_type: 'Laminated',
      // Assume 12mm tape
      media_width_mm: 12
    }
  },
  { deviceCode: 0x4A, name: "PT500" },
  { deviceCode: 0x64, name: "PT-H500" },
  { deviceCode: 0x65, name: "PT-E500" },
  { deviceCode: 0x67, name: "PT-P700" },
  { deviceCode: 0x69, name: "PT-P900W" },
  { deviceCode: 0x70, name: "PT-P950NW" },
  { deviceCode: 0x71, name: "PT-P900" },
  { deviceCode: 0x78, name: "PT-P910BT" }
];

/**
 * An object giving the current status of the printer
 */
class PrinterStatus {

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
   * Get the model by device code.
   * @param {number} code model device code to find
   * @return {object} object from the MODELS array above
   * @private
   */
  static getModelByDeviceCode(code) {
    for (const m of MODELS) {
      if (m.deviceCode == code)
        return m;
    }
    return undefined;
  }

  /**
   * Get the model by name. Matches if the name passed starts with
   * the model name, so "PT1230PC", "PT1230F" will both match model "PT1230".
   * @param {string} name model name to find
   * @return {object} object from the MODELS array above
   * @private
   */
  static getModelByName(name) {
    for (const m of MODELS) {
      if (name.indexOf(m.name) == 0)
        return m;
    }
    return undefined;
  }

  /**
   * Derive shortcut dimensions from a partially-filled status report.
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
   * @private
   */
  parseRaw(raw) {
    if (raw.length < 32) throw new Error(`Bad report length ${raw.length}`);

    if (raw[0] !== 0x80) throw new Error(`Bad print head mark ${raw[0]}`);
    // raw[1] = Print head size, don't know what this is
    if (raw[2] !== 0x42) throw new Error(`Bad Brother code ${raw[2]}`);
    if (raw[3] !== 0x30) throw new Error(`Bad series code ${raw[2]}`);
    if (raw[5] !== 0x30) throw new Error(`Bad country code ${raw[3]}`);

    // Determine the printer model
    const model = PrinterStatus.getModelByDeviceCode(raw[4]);
    if (!model)
      throw new Error(`Unsupported device code 0x${Number(raw[4]).toString(16)}`);
    this.model = model.name;

    if (model.defaultStatus)
      this.copy(model.defaultStatus);

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
    case 0x06: this.status_type = "Phase change"; break;
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
  }

  copy(status) {
    for (const key of Object.keys(status))
      this[key] = status[key];
  }

  static from(status, debug) {
    const s = new PrinterStatus(undefined, debug);
    if (status) {
      s.copy(status);
      s.deriveDimensions();
    }
    return s;
  }

  /**
   * @param {Buffer?} raw an optional byte buffer containing a status report
   * to be parsed
   * @param {function} debug function
   */
  constructor(raw, debug = () => {}) {
    
    /**
     * Number of mm of tape to emit to cause an eject. Per model.
     * @member {number}
     */
    this.eject_mm = 0;

    /**
     * Number of rasters to emit to cause an eject
     * @member {number}
     */
	  this.eject_px = 0;

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
     * Width of a single pixel in mm
     * @member {number}
     */
    this.pixel_width_mm = 0;

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
     * Width of tape media in px
     * @member {number}
     */
    this.media_width_px = 0;

    /**
     * Current printer phase, one of "Initialisation", "Receiving",
     * "Printing", "Feeding"
     */
    this.phase = "Initialisation";

    if (raw) {
      this.parseRaw(raw);
      // Use the report to determine additional dimensions
      this.deriveDimensions(debug);
    }
  }
}

export { PrinterStatus }
