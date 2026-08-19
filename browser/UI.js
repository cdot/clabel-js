/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env browser */

/**
 * User interface to capture HTML definitions of labels that can then
 * be sent (as images) to a label printer server.
 */
import { PTouchStatus } from "./PTouchStatus.js";

/* domtoimage comes from package dom-to-image-more */
/* global domtoimage */

// Last status received from the server. This describes the printer.
let currentStatus = new PTouchStatus();

// Equiv of jQuery $.extend
function extend(a, b){
  for (const key in b)
    if (!a.hasOwnProperty(key) && b.hasOwnProperty(key))
      a[key] = b[key];
  return a;
}

const defaults = {
  name: "",
  html: "",
  tightCrop: false,
  fontFamily: "sansserif",
  fontSize: 56,
  leftMargin: 0,
  rightMargin: 0,
  textAlign: "center",
  ejectPX: 10,
  // Thresholds for colour conversion, tunable per image
  alphaThreshold: 30,
  colourThreshold: 200
};

// The current label
let label = extend({}, defaults);

/**
 * Set the textContent on an element identified by id
 * @param {string} id the id of the element
 * @param {string} s the text content
 */
function setText(id, s) {
  document.getElementById(id).textContent = s;
}

// Update printer status information fields
function setStatus(s) {
  currentStatus = s;

  setText("model_name", s.model);
  setText("media_width_mm", s.media_width_mm);
  setText("printable_width_mm", s.printable_width_mm);
  setText("printable_width_px", s.printable_width_px);
  setText("phase", PTouchStatus.Phase[s.phase]);
  setText("ejectMM", (label.ejectPX * s.pixel_size_mm).toFixed(2));

  document.getElementById("review_liner").minHeight = s.printable_width_px;

  refreshImage();
}

/**
 * Given a Uint8Array containing 4-byte image data, trim empty rows
 * from top and bottom.
 * @param {Uint8Array} data the image data
 * @param {number} w image width
 * @param {number} h image height
 * @return {number[]} [0] = top of trimmed image [1] = new height
 */
function trimEmptyRows(data, w, h) {

  function keep(data, offset) {
    const r = data[offset+0], b = data[offset+1],
          g = data[offset+2], a = data[offset+3];
    return r > 0 || g > 0 || b > 0 || a > 0;
  }

  // crop the image from the top down
  let top = 0, crop = true;
  while (crop && top < h) {
    for (let x = 0; x < w; x++) {
      if (keep(data, (top * w + x) * 4)) {
        //console.debug(`First top keep at ${top},${x}`);
        crop = false;
        break;
      }
    }
    if (crop) top++;
  }

  if (top >= h) {
    // still cropping when we reached the bottom of the image
    //console.debug("trimEmptyRows: Image is empty");
    return [ 0, h ];
  }

  // Found at least one uncroppable row, crop up from the bottom
  let height = h - top;
  crop = true;
  while (crop && height > 0) {
    for (let x = 0; x < w; x++) {
      if (keep(data, ((top + height - 1) * w + x) * 4)) {
        //console.debug(`First bottom keep at ${height},${x}`);
        crop = false;
        break;
      }
    }
    if (crop) height--;
  }
  //console.debug(`trimEmptyRows: (0, ${h}) to (${top},${height})`);
  return [ top, height ];
}

/**
 * Simple algorithm to convert an RGBA image to black and white.
 * Works on the data in place, simply sets black pixels as opaque and white
 * pixels as transparent.
 * @param {Uint8Array} data the image data
 * @param {number} w image width
 * @param {number} h image height
 */
function BandW(data, w, h) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w;x++) {
      const offset = ((y * w) + x) * 4;
      if (data[offset + 3] >= label.alphaThreshold) {
        let bw = data[offset + 0] * 0.3
            + data[offset + 1] * 0.59
            + data[offset + 2] * 0.11;
        // We are painting on a white background, so colours that
        // give a higher bw are increasingly washed out and need to
        // map to white. Darker colours map to black.
        // Note that colours trend to white only when all three channels
        // are above the colour threshold. If one colour is below
        // the threshold, we want to see it
        if (data[offset + 0] >= label.colourThreshold
            && data[offset + 1] >= label.colourThreshold
            && data[offset + 2] >= label.colourThreshold
            && bw >= label.colourThreshold)
          data[offset + 3] = 0;
        else {
          data[offset + 0] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
    }
}

/**
 * Render the label to the Image canvas
 */
function refreshImage() {
  // Use a timeout to make sure the UI is fully updated
  setTimeout(() => {
    const node = document.getElementById("review_div");
    const image_liner = document.getElementById("image_liner");
    const w = node.scrollWidth;
    let top = 0;
    let h = node.scrollHeight;

    if (node.textContent === ""
        || w <= 0 || h <= 0) {
      image_liner.style.display = "none";
      return;
    }
    image_liner.style.display = "block";

    // Generate a canvas from the review div (which contains the rendered
    // HTML)
    domtoimage
    .toCanvas(node, {
      // SMELL: this should be w, but in that case there are labels where
      // words get left off the end - something to do with the SVG rendering,
      // probably. Seems to work OK with +1, though. h doesn't seem to be a
      // problem.
      width: w + 1,
      height: h
    })
    .then(dom_canvas => {
      // Get a rendering context, and read the image data
      const dom_ctx = dom_canvas.getContext('2d');
      const imageData = dom_ctx.getImageData(0, 0, w, h);

      // Monochromise the image data
      BandW(imageData.data, w, h);

      // Write the image data back to the source context
      dom_ctx.putImageData(imageData, 0, 0);

      if (label.tightCrop)
        // Determine how to ignore empty rows at top and bottom.
        [ top, h ] = trimEmptyRows(imageData.data, w, h);

      // draw the image data into the #image_canvas
      const canvas = document.getElementById("image_canvas");
      canvas.width = w; canvas.height = h;
      image_liner.style.width = `${w}px`;
      image_liner.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(dom_canvas, 0, top, w, h, 0, 0, w, h);

      setText("label_length_px", w);
      setText("label_length_mm", (w * currentStatus.pixel_size_mm).toFixed(2));

      setText("label_width_px", h);
      setText("label_width_mm", (h * currentStatus.pixel_size_mm).toFixed(2));

      // If the image is wider (taller) than the tape, show the tape
      // bounds and an error message
      if (h > currentStatus.printable_width_px) {
        const tb = document.getElementById("tape-bounds");
        tb.style.height = `${currentStatus.printable_width_px}px`;
        tb.style.display = "block";
        document.getElementById("width-error").style.display = "block";
      } else {
        document.getElementById("tape-bounds").style.display = "none";
        document.getElementById("width-error").style.display = "none";
      }
    });
  }, 100);
}

/**
 * Reflect the current label in the UI
 */
function showLabel() {
  const review_div = document.getElementById("review_div");
  const classList = review_div.classList;
  for (const cls of classList) {
    if (cls.indexOf("font-family-") === 0) {
      classList.remove(cls);
      break;
    }
  }
  classList.add(`font-family-${label.fontFamily}`);

  document.getElementById("save").disabled = (label.name === "");

  review_div.style.fontSize = `${label.fontSize}px`;
  review_div.style.paddingLeft = `${label.leftMargin}px`;
  review_div.style.paddingRight = `${label.rightMargin}px`;
  review_div.style.textAlign = label.textAlign;
  review_div.innerHTML = label.html;

  setText("ejectMM", (label.ejectPX / currentStatus.pixel_size_mm).toFixed(2));

  refreshImage();
}

/**
 * Write the current label attributes to the UI inputs
 */
function label2UI() {
  for (const f of Object.keys(label)) {
    //console.debug(f,"=",label[f]);
    const el = document.getElementById(f);
    el.value = label[f];
  }
  showLabel();
}

/**
 * Load the loadables select from the list from the server
 */
function loadLoadables() {
  fetch(`/ajax/list`)
  .then(response => response.json())
  .then(json => {
    const loadables = document.getElementById("loadables");
    for (const loadable of json) {
      const el = document.createElement("option");
      el.textContent = loadable;
      loadables.append(el);
    }
  });
}

/**
 * Add UI event handlers
 */
function addEventListeners() {

  function listen(event, id, field = "value") {
    document.getElementById(id).addEventListener(event, () => {
      label[id] = document.getElementById(id)[field];
      //console.debug(id,"=",label[id]);
      showLabel();
    });
  }

  listen("change", "name");
  listen("change", "fontFamily");
  listen("change", "fontSize");
  listen("change", "leftMargin");
  listen("change", "rightMargin");
  listen("change", "textAlign");
  listen("change", "colourThreshold");
  listen("change", "alphaThreshold");
  listen("change", "ejectPX");
  listen("change", "tightCrop", "checked");
  listen("keyup", "html");

  document.getElementById("print").addEventListener("click", () => {
    const data_url = document.getElementById("image_canvas").toDataURL();
    fetch(data_url)
    .then(data => data.blob())
    .then(blob => fetch("/ajax/print", {
      method: "POST",
      headers: {
        "Content-Type": "image/png"
      },
      body: blob
    }))
    .then(res => setText("printer_status", res));
  });

  document.getElementById("eject").addEventListener("click", () => {
    fetch(`/ajax/eject?px=${label.ejectPX}`, {
      method: "POST"
    });
  });

  document.getElementById("save").addEventListener("click", () => {
    fetch(`/ajax/put/${label.name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(label)
    })
    .then(response => {
      if (response.status === 200)
        alert(`Saved ${label.name}`);
      else
        alert(`Save failed: ${response.statusText}`);
      loadLoadables();
    })
    .catch(e => alert(`Error ${e}`));
  });

  document.getElementById("load")
  .addEventListener("click", () => {
    const name = document.getElementById("loadables").value;
    fetch(`/ajax/get/${name}`)
    .then(response => response.json())
    .then(json => {
      label = extend(json, defaults);
      label2UI();
    })
    .catch(e => alert(`Error ${e}`));
  });

  document.getElementById("clear")
  .addEventListener("click", () => {
    label = extend({}, defaults);
    label2UI();
  });
}

// Main program
window.addEventListener("load", () => {

  io().on(PTouchStatus.UPDATE_EVENT, state => setStatus(state));

  label2UI();
  loadLoadables();
  addEventListeners();

  fetch("/ajax/status")
  .then(response => response.json())
  .then(js => setStatus(js));

  refreshImage();
});
