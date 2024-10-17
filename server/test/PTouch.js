/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node, mocha */

import { assert } from "chai";
import { PTouch } from "../src/PTouch.js";
import { toBinary, fromBinary } from "../src/Readable.js";

// 8 pixels wide by 22 high, this is an upper-case L on it's side.
const L_width = 8;
const L_height = 22;
const L_img = Buffer.from([
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,252,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,116,  0,0,0,253,  0,0,0, 80,  0,0,0, 80,  0,0,0,0,  0,0,0, 80,  0,0,0,8,  
  0,0,0,0,  0,0,0,116,  0,0,0,255,  0,0,0,255,  0,0,0,255,  0,0,0,5,  0,0,0,255,  0,0,0,2,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0,  
  0,0,0,0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,  0,  0,0,0,0,  0,0,0,  0,  0,0,0,0
]);

let pendingOutput;

describe("PTouch", () => {

  function UNit() {}

  // Requires a PT1230C device on /dev/usb/lp0
  UNit("status", () => {
    const dev = new PTouch({ model: "PT1230PC", device: "/dev/usb/lp0", debug: console.debug });
    return dev.initialise()
    .then(() => dev.getStatusReport())
    .then(status => {
      assert.equal(status.eject_mm, 10);
      assert.equal(status.raster_px, 128);
      assert.equal(status.raster_mm, 18);
      assert.equal(status.printable_width_px, 64);
      assert.equal(status.printable_width_mm, 9);
      assert.equal(status.phase, 'Receiving');
      assert.equal(status.model, 'PT1230');
      assert.equal(status.media_type, 'Laminated');
      assert.equal(status.media_width_mm, 12);
      assert.equal(status.eject_px, 71);
      assert.equal(status.pixel_width_mm, 0.140625);
      assert.equal(status.media_width_px, 85.33333333333333);
    })
    .then(() => dev.close());
  });
  
  // Doesn't require a device
  UNit("status", () => {
    const dev = new PTouch({ model: "PT1230PC_F", device: "/tmp/blah", debug: console.debug });
    return dev.initialise()
    .then(() => console.log(dev.status))
    .then(() => dev.getStatusReport())
    .then(status => {
      assert.equal(status.eject_mm, 10);
      assert.equal(status.raster_px, 128);
      assert.equal(status.raster_mm, 18);
      assert.equal(status.printable_width_px, 64);
      assert.equal(status.printable_width_mm, 9);
      assert.equal(status.model, 'PT1230');
      assert.equal(status.media_type, 'Laminated');
      assert.equal(status.media_width_mm, 12);
      assert.equal(status.eject_px, 71);
      assert.equal(status.pixel_width_mm, 0.140625);
      assert.equal(status.media_width_px, 85.33333333333333);
    })
    .then(() => dev.close());
  });
  
  it ("tall image, to file", () => {
    const dev = new PTouch({ model: "PT1230_F", device: "/tmp/ptouch", debug: console.debug });
    return dev.initialise()
    .then(() => dev.printImage(L_img, L_width, L_height))
    .then(() => dev.close());
  });

  UNit("wide image", () => {
    const dev = new PTouch({ model: "PT1230_F", device: "/tmp/ptouch", debug: console.debug });
    return dev.initialise()
    .then(() => {
      // Make an image wider than the printable width by duplicating each
      // row
      const copies = (dev.printable_width_px * 2) / L_width;
      console.debug(`Making ${copies} copies`);
      const W_img = [];
      for (let y = 0; y < L_height; y++) {
        for (let c = 0; c < copies; c++) {
          for (let x = 0; x < L_width; x++) {
            for (let b = 0; b < 4; b++)
              W_img.push(L_img[(y * L_width + x) * 4 + b]);
          }
        }
      }
      // We expect 2 tape runs
      return dev.printImage(Buffer.from(W_img), L_width * copies, L_height);
    })
    .then(() => dev.close());
  });
});
