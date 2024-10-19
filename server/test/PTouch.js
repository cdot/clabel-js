/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node, mocha */
import { promises as Fs } from "node:fs";
import { assert } from "chai";
import { PTouch } from "../src/PTouch.js";
import { Models } from "../src/Models.js";
import { toBinary, fromBinary } from "../src/Readable.js";
import tmp from 'tmp-promise';

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
  it("status (PT1230)", () => {
    const dev = new PTouch({
      //debug: console.debug,
      device: "/dev/usb/lp0"
    });
    return dev.initialise()
    .then(() => dev.getStatusReport())
    .then(status => {
      assert.equal(status.raster_px, 128);
      assert.equal(status.raster_mm, 18);
      assert.equal(status.printable_width_px, 64);
      assert.equal(status.printable_width_mm, 9);
      assert.equal(status.phase, 'Receiving');
      assert.equal(status.model, 'PT1230');
      assert.equal(status.media_type, 'Laminated');
      assert.equal(status.media_width_mm, 12);
      assert.equal(status.eject_mm, 20);
      assert.equal(status.eject_px, 142);
      assert.equal(status.pixel_width_mm, 0.140625);
      assert.equal(status.media_width_px, 85.33333333333333);
    })
    .then(() => dev.close())
    .catch(e => {
      assert.equal(e.code, "ENOENT", e);
      console.log(`*** "status (PT1230)" skipped because device not reachable`);
    });
  });

  it("no device status", () => {
    return tmp.file()
    .then(fo => {
      const dev = new PTouch({
        debug: console.debug,
        model: Models.getModelByName("PT1230"),
        write_only: true,
        device: fo.path
      });
      return dev.initialise()
      .then(() => {
        assert.equal(dev.model.name, "PT1230");
        assert(dev.write_only);
        assert(dev.status);
        assert.equal(dev.status.model, "PT1230");
        assert.equal(dev.status.raster_px, 128);
        assert.equal(dev.status.raster_mm, 18);
        assert.equal(dev.status.printable_width_px, 64);
        assert.equal(dev.status.printable_width_mm, 9);
        assert.equal(dev.status.phase, 'Initialisation');
        assert.equal(dev.status.model, 'PT1230');
        assert.equal(dev.status.media_type, 'Laminated');
        assert.equal(dev.status.media_width_mm, 12);
        assert.equal(dev.status.eject_mm, 20);
        assert.equal(dev.status.eject_px, 142);
        assert.equal(dev.status.pixel_width_mm, 0.140625);
        assert.equal(dev.status.media_width_px, 85.33333333333333);
      });
    });
  });
      
  it("tall image, to file", () => {
    return tmp.file()
    .then(fo => {
      const dev = new PTouch({
        //debug: console.debug,
        model: "PT1230",
        write_only: true,
        device: fo.path
      });
      return dev.initialise()
      .then(() => dev.printImage(L_img, L_width, L_height))
      .then(() => dev.close())
      .then(() => Fs.readFile(fo.path))
      .then(data => fromBinary(data))
      .then(text => {
        let i = 0;
        while (text[i] == "Invalidate")
          i++;
        assert.equal(i, 200);
        assert.equal(text[i++], "Initialise_clear");
        assert.equal(text[i++], "Compress 0");
        assert.equal(text[i++], "Raster_mode 1");
        assert.equal(text[i++], "Feed 0");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Raster 000000007f00000000000000");
        assert.equal(text[i++], "Raster 000000007b00000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Raster 000000006000000000000000");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Print 0");
      });
    });
  });

  it("wide image, to file", () => {
    return tmp.file()
    .then(fo => {
      const dev = new PTouch({
        //bug: console.debug,
        model: "PT1230",
        write_only: true,
        device: fo.path
      });
      return dev.initialise()
      .then(() => {
        // Make an image wider than the printable width by duplicating each
        // row
        const copies = (dev.status.printable_width_px * 2) / L_width;
        //console.debug(`Making ${copies} copies`);
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
      .then(() => dev.close())
      .then(() => Fs.readFile(fo.path))
      .then(data => fromBinary(data))
      .then(text => {
        let i = 0;
        while (text[i] == "Invalidate")
          i++;
        assert.equal(i, 200);
        assert.equal(text[i++], "Initialise_clear");
        assert.equal(text[i++], "Compress 0");
        assert.equal(text[i++], "Raster_mode 1");
        assert.equal(text[i++], "Feed 0");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Raster 000000007f7f7f7f7f7f7f7f");
        assert.equal(text[i++], "Raster 000000007b7b7b7b7b7b7b7b");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Raster 000000006060606060606060");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
        assert.equal(text[i++], "Empty_raster");
      });
    });
  });
});
