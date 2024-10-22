/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node */

const DEFAULT_PT1230 = {
  // Number of rasters (though not all will have pins!)
  raster_px: 128,
  // Must be 18mm even though the PT1230 only supports up to 12mm tape.
  raster_mm: 18,
  // A single raster sent to the printer will have 4 pad bytes
  // before and after the actual printable raster data.
  printable_width_px: 64,
  // 9mm printable width, not possible to print full raster_mm width
  printable_width_mm: 9,
  media_type: 'Laminated',
  media_width_mm: 12
};

/**
 * Model information descriptor.
 */
class Model {
  constructor(deviceCode, name, defaultStatus) {
    /**
     * Device identifier code, as returned in a status report
     * @member {number}
     */
    this.deviceCode = deviceCode;

    /**
     * User-friendly device type identifier
     * @member {string}
     */
    this.name = name;

    /**
     * Block of default status info for this model. This is intended
     * to be used as a template for PTouchStatus.from()
     * @member {object}
     */
    this.defaultStatus = defaultStatus;
  }
}

const MODELS = [
  new Model(0x59, "PT1230", DEFAULT_PT1230),
  // TODO: tune defaultStatus for different models.
  new Model(0x4A, "PT500", DEFAULT_PT1230),
  new Model(0x64, "PT-H500", DEFAULT_PT1230),
  new Model(0x65, "PT-E500", DEFAULT_PT1230),
  new Model(0x67, "PT-P700", DEFAULT_PT1230),
  new Model(0x69, "PT-P900W", DEFAULT_PT1230),
  new Model(0x70, "PT-P950NW", DEFAULT_PT1230),
  new Model(0x71, "PT-P900", {
    raster_px: 512,
    raster_mm: 36,
    printable_width_px: 454,
    printable_width_mm: 32.03,
    media_type: 'Laminated',
    media_width_mm: 36
  }),
  new Model(0x78, "PT-P910BT", DEFAULT_PT1230)
];

/**
 * Model information gleaned from Brother documents and printers.
 * name: text name of the device
 * deviceCode: model code reported in status reports
 * defaultStatus: a default status block, for use when the device can't be read
 * from.
 * TODO: split this out into json files
 */
class Models {

  /**
   * Get the model by device code.
   * @param {number} code model device code to find
   * @return {object} object from the MODELS array above
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
   * @return {Model} object from the MODELS array above
   */
  static getModelByName(name) {
    for (const m of MODELS) {
      if (name.indexOf(m.name) == 0)
        return m;
    }
    return undefined;
  }

  /**
   * Get a list of models
   * @return {Model[]} all models
   */
  static all() {
    return MODELS;
  }

  /**
   * Get the default model
   * @return {Model} the default model
   */
  static default() {
    return MODELS[0];
  }
};

export { Model, Models }
