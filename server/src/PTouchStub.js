/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
import { PTouch } from "./PTouch.js";

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
        //this.output.push(`INVAL`);
        continue;
      case 0x1B:
        switch(buff[i++]) {
        case 0x40:
          //this.output.push(`-`);
          continue;
        case 0x69:
          switch (buff[i++]) {
          case 0x53:
            this.output.push(`STAT`);
            pendingOutput = STATUS_REPORT;
            continue;
          case 0x52:
            this.output.push(`RM${buff[i++]}`);
            continue;
          case 0x64:
            const fa = buff[i++];
            this.output.push(`FD${fa + buff[i++] * 256}`);
            continue;
          default:
            throw new Error(`Command error 0x1B 0x69 0x52 0x${buff[i-1].toString(16)}`);
          }
        }
        throw new Error(`Protocol violation 0x1B 0x${buff[i-1].toString(16)}`);
      case 0x1A: this.output.push(`FF`); continue;
      case 0x0C: this.output.push(`NF`); continue;
      case 0x5A: this.output.push(`E`); continue;
      case 0x4D: this.output.push(`COM${buff[i++]}`); continue;
      case 0x47:
        // The image is 8 pixels by 22 high. It's been rotated, so we hope
        // to have 8 rasters, each 22 bits (3 bytes) wide. Each raster has
        // 32px = 4 pad bytes to get onto the printable area.
        let length = buff[i++];
        length += buff[i++] * 256;
        let s = "";
        for (let j = 0; j < length; j++) {
          s += Number(buff[i++]).toString(16).padStart(2, "0");
        }
        this.output.push(`R${s}`);
        continue;
      default:
        throw new Error(`Protocol violation 0x${buff[i-1].toString(16)}`);
      }
    }
    this.debug(this.output.join("\n"));
    return Promise.resolve({ bytesWritten: buff.length });
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
    return Promise.resolve({ bytesRead: out.length, buffer: out });
  }

  initialise() {
    this.output = [];
    this.initialised = true;
    return this.getStatusReport()
    .then(sr => { console.log(sr); return sr; });
  }
}

export { PTouchStub }
