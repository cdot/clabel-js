/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node, mocha */

import { assert } from "chai";
import { toBinary, fromBinary } from "../src/Readable.js";

const commands = [
  "Status",
  "Invalidate",
  "Initialise_clear",
  "Compress 0",
  "Raster_mode 1",
  "Feed 0",
  "Empty_raster",
  "Raster 020406080a0c0e1030507090b0d0f0",
  "Print 0",
  "Print 1"
];

describe("Readable", () => {
  it("to/from binary", () => {
    const buffer = toBinary(commands);
    const back = fromBinary(buffer);
    assert.deepEqual(back, commands);
  });
});
