/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node, mocha */

import { assert } from "chai";
import { PTouchStub } from "../src/PTouchStub.js";

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

  it("status", () => {
    const dev = new PTouchStub({ device: "/dev/usb/lp0" });
    return dev.getStatus()
    .then(status => {
      assert.equal(status.eject_mm, 10);
      assert.equal(status.raster_px, 128);
      assert.equal(status.raster_mm, 18);
      assert.equal(status.printable_width_px, 64);
      assert.equal(status.printable_width_mm, 9);
      assert.equal(status.phase, 'Receiving');
      assert.equal(status.model, 'PT1230PC');
      assert.equal(status.media_type, 'Laminated');
      assert.equal(status.media_width_mm, 12);
      assert.equal(status.eject_px, 71);
      assert.equal(status.pixel_width_mm, 0.140625);
      assert.equal(status.media_width_px, 85.33333333333333);
    });
  });
  
  it("tall image", () => {
    const dev = new PTouchStub({ device: "/dev/usb/lp0", debug: console.debug });
    return dev.printImage(L_img, L_width, L_height)
    .then(() => dev.close())
    .then(() => assert.equal(dev.output.join(""),
                             `STAT`
                             +`COM0`
                             +`RM1`
                             +`FD0`
                             +`EEEEE`
                             +`R000000007a00000000000000`
                             +`R000000007a00000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`R000000006000000000000000`
                             +`EEEEE`
                             +`NF`));
  });

  it("wide image", () => {
    const dev = new PTouchStub({ device: "/dev/usb/lp0", debug: console.debug });
    return dev.initialise()
    .then(() => {
      // Make an image wider than the printable width by duplicating each
      // row
      const copies = (dev.status.printable_width_px * 2) / L_width;
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
    .then(() => {
      assert.equal(dev.output.join(""),
                   `STAT`
                   +`COM0`
                   +`RM1`
                   +`FD0`
                   +`EEEEE`
                   +`R000000007a7a7a7a7a7a7a7a`
                   +`R000000007a7a7a7a7a7a7a7a`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`EEEEE`
                   +`NF`
                   +`EEEEE`
                   +`R000000007a7a7a7a7a7a7a7a`
                   +`R000000007a7a7a7a7a7a7a7a`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`R000000006060606060606060`
                   +`EEEEE`
                   +`NF`);
    })
    .then(() => dev.close());
  });
});
