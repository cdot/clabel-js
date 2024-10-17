/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/

/**
 * Decode a byte buffer full of PTouch print commands to a simple
 * readable text format.
 */
function fromBinary(buff) {
  let output = [];
  let i = 0;
  while (i < buff.length) {
    switch (buff[i++]) {
    case 0x00:
      output.push(`Invalidate`);
      continue;
    case 0x1B:
      switch(buff[i++]) {
      case 0x40:
        output.push(`Initialise_clear`);
        continue;
      case 0x69:
        switch (buff[i++]) {
        case 0x53:
          output.push(`Status`);
          continue;
        case 0x52:
          output.push(`Raster_mode ${buff[i++]}`);
          continue;
        case 0x64:
          const fa = buff[i++];
          output.push(`Feed ${fa + buff[i++] * 256}`);
          continue;
        default:
          throw new Error(`Command error 0x1B 0x69 0x52 0x${buff[i-1].toString(16)}`);
        }
      }
      throw new Error(`Protocol violation 0x1B 0x${buff[i-1].toString(16)}`);
    case 0x1A: output.push(`Print 1`); continue;
    case 0x0C: output.push(`Print 0`); continue;
    case 0x5A: output.push(`Empty_raster`); continue;
    case 0x4D: output.push(`Compress ${buff[i++]}`); continue;
    case 0x47:
      let length = buff[i++];
      length += buff[i++] * 256;
      let s = "";
      for (let j = 0; j < length; j++)
        s += Number(buff[i++]).toString(16).padStart(2, "0");
      output.push(`Raster ${s}`);
      continue;
    default:
      throw new Error(`Protocol violation 0x${buff[i-1].toString(16)}`);
    }
  }
  return output;
}

/**
 * Convert a set of text commands to a binary buffer.
 * @param {string[]} commands list of commands
 * @return {Buffer} a byte buffer
 */
function toBinary(commands) {
  const buff = [];
  let v;
  for (const command of commands) {
    let cmd = command.split(/\s+/);
    const verb = cmd[0];
    let param = cmd[1];
    switch (verb) {
    case "Invalidate": buff.push(0x00); break;
    case "Initialise_clear": buff.push(0x1B, 0x40); break;
    case "Status": buff.push(0x1B, 0x69, 0x53); break;
    case "Raster_mode":
      buff.push(0x1B, 0x69, 0x52, parseInt(param));
      break;
    case "Feed":
      param = parseInt(param);
      buff.push(0x1B, 0x69, 0x64, param % 256, Math.floor(param / 256));
      break;
    case "Print": buff.push(param == "1" ? 0x1A : 0x0C); break;
    case "Empty_raster": buff.push(0x5A); break;
    case "Compress": buff.push(0x4D, parseInt(param)); break;
    case "Raster":
      buff.push(0x47, (param.length / 2) % 256, Math.floor((param.length / 2) / 256));
      // Repack the raster
      for (let i = 0; i < param.length; i += 2) {
        const byte = parseInt(`${param[i]}${param[i + 1]}`, 16);
        buff.push(byte);
      }
      break;
    default:
      throw new Error(`toBinary error at ${command}`);
    }
  }
  return Buffer.from(buff);
}

export { toBinary, fromBinary }
