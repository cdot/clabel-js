/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
import { PTouch } from "../src/PTouch.js";

let pendingOutput;

const STATUS_REPORT = Buffer.from([
  0x80, 0x20, 0x42, 0x30, 0x59, 0x30, 0x00, 0x00,
  0x00, 0x00, 0x0c, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

/**
 * Layer over PTouch that overrides read and write for debug
 */
class PTouchStub extends PTouch {

  /**
   * @override
   */
  write(buff) {
    //console.debug(`Rx ${buff.map(v => Number(v).toString(16)).join(" ")}`);
    let i = 0;
    while (i < buff.length) {
      const at = i;
      switch (buff[i++]) {
      case 0x00:
        //console.debug(`INVALIDATE`);
        continue;
      case 0x1B:
        switch(buff[i++]) {
        case 0x40:
          console.debug(`INITIALISE_CLEAR`);
          continue;
        case 0x69:
          switch (buff[i++]) {
          case 0x53:
            console.debug(`SEND_PRINTER_STATUS`);
            pendingOutput = STATUS_REPORT;
            continue;
          case 0x52:
            console.debug(`SET_RASTER_MODE ${buff[i++]}`);
            continue;
          case 0x64:
            const fa = buff[i++];
            console.debug(`FEED_AMOUNT ${fa + buff[i++] * 256}`);
            continue;
          default:
            throw new Error(`Command error 0x1B 0x69 0x52 0x${buff[i-1].toString(16)}`);
          }
        }
        throw new Error(`Protocol violation 0x1B 0x${buff[i-1].toString(16)}`);
      case 0x1A: console.debug(`PRINT_FEED`); continue;
      case 0x0C: console.debug(`PRINT_NOFEED`); continue;
      case 0x5A: console.debug(`EMPTY_RASTER`); continue;
      case 0x4D: console.debug(`COMPRESSION ${buff[i++]}`); continue;
      case 0x47:
        // The image is 8 pixels by 22 high. It's been rotated, so we hope
        // to have 8 rasters, each 22 bits (3 bytes) wide. Each raster has
        // 32px = 4 pad bytes to get onto the printable area.
        let length = buff[i++];
        length += buff[i++] * 256;
        let s = "";
        for (let j = 0; j < length; j++) {
          const bits = buff[i];
          for (let k = 7; k >= 0; k--)
            s += (bits & (1 << k)) > 0 ? "X" : ".";
          //s += Number(bits).toString(16);
          s += "|";
          i++;
        }
        console.debug(`SEND_RASTER ${length} ${s}`);
        continue;
      default:
        throw new Error(`Protocol violation 0x${buff[i-1].toString(16)}`);
      }
    }
    return Promise.resolve();
  }

  /**
   * @override
   */
  read() {
    // Check we had a status request
    if (!(pendingOutput instanceof Buffer))
      return Promise.resolve([]);
    const out = pendingOutput;
    pendingOutput = undefined;
    return Promise.resolve(out);
  }
}

export { PTouchStub }
