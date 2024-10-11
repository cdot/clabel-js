/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node, mocha */

import { assert } from "chai";
import { PTouch } from "../src/PTouch.js";
import { PTouchStub } from "./PTouchStub.js";

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

  // Requires a device on /dev/usb/lp0
  UNit("query real device", () => {
    const dev = new PTouch({ device: "/dev/usb/lp0", debug: console.debug });
    return dev.initialise()
    .then(() => dev.close());
  });

  UNit ("tall image", () => {
    const dev = new PTouchStub({ device: "/dev/usb/lp0", debug: console.debug });
    return dev.printImage(L_img, L_width, L_height)
    .then(() => dev.close());
  });

  it("wide image", () => {
    const dev = new PTouchStub({ device: "/dev/usb/lp0", debug: console.debug });
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
