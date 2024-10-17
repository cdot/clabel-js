/* eslint-env browser */

import { io } from "./node_modules/socket.io/client-dist/socket.io.esm.min.js";

/* global domtoimage */

// Last info received from the server. This describes the printer.
let info = {
  model: "Unknown",
  pixel_width_mm: 0,
  eject_px: 0,
  eject_mm: 0,
  raster_px: 0,
  raster_mm: 0,
  printable_width_px: 0,
  printable_width_mm: 0,
  media_width_px: 0,
  media_width_mm: 0,
  phase: "Uninitialised"
};

// Thresholds for colour conversion, tunable per image
let alphaThreshold = 30;
let colourThreshold = 30;

/**
 * Get the current selection in the textarea. If start and end
 * are the same, there is no selection. The selection persists
 * when the textarea no longer has the focus, and only gets
 * cleared when it regains the focus.
 */
function getTextSelection() {
  const txtarea = $("#label_text")[0];
  return {
    start: txtarea.selectionStart,
    end: txtarea.selectionEnd
  };
}

function setInfo(n) {
  info = n;
  for (const f of Object.keys(info)) {
    $(`.text-${f}`).text(info[f]);
    $(`.min-height-${f}`).css("min-height", `${info[f]}px`);
  }
  refreshImage();
}

/**
 * Given a Uint8Array containing 4-byte image data, trim empty rows
 * from top and bottom.
 * @param {Uint8Array} data the image data
 * @param {number} w image width
 * @param {number} h image height
 * @return {object.<above, below>} number of rows above and below the
 * image to be trimmed
 */
function trim(data, w, h) {

  function keep(data, offset) {
    const r = data[offset+0], b = data[offset+1],
          g = data[offset+2], a = data[offset+3];
    return r > 0 || g > 0 || b > 0 || a > 0;
  }

  // crop the image from the top down
  let cropping = true;
  let above, crop = true;
  for (above = 0; crop && above < h; above++) {
    for (let x = 0; x < w; x++) {
      if (keep(data, (above * w + x) * 4)) {
        crop = false;
        break;
      }
    }
  }

  let below = 0;
  if (above >= h)
    // still cropping when we reached the top of the image
    above = 0;
  else {
    // Found at least one uncroppable row, crop up from the bottom
    crop = true;
    for (below = 0; crop && h - below > above; below++) {
      for (let x = 0; x < w; x++) {
        if (keep(data, ((h - 1 - below) * w + x) * 4)) {
          crop = false;
          break;
        }
      }
    }
    if (below > 0) below--;
  }
  return { above, below };
}

/**
 * Simple algorithm to convert an RGBA image to black and white. Works on
 * the data in place.
 * @param {Uint8Array} data the image data
 * @param {number} w image width
 * @param {number} h image height
 */
function BandW(data, w, h) {
  console.log(w,"x", h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w;x++) {
      const offset = ((y * w) + x) * 4;
      if (data[offset + 3] > alphaThreshold) {
        let bw = data[offset + 0] * 0.3
            + data[offset + 1] * 0.59
            + data[offset + 2] * 0.11;
        // We are painting on a white background, so colours that
        // give a higher bw are increasingly washed out and need to
        // map to white. Darker colours map to black.
        // 200 threshold chosen arbitrarily.
        // TODO: make the threshold selectable in the UI
        if (bw > colourThreshold)
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

function refreshImage() {
  domtoimage
  // Get a Uint8Array with every 4 elements representing the RGBA data
  .toPixelData($("#review_div")[0])
  .then(data => {
    // Construct an ImageData object from the pixel data
    const node = $("#review_div")[0];
    const w = node.scrollWidth;
    const h = node.scrollHeight;
    const { above, below } = trim(data, w, h);
    console.log("Garter and stockings", above, below, w, h);
    BandW(data, w, h);

    // render the cropped area to an ImageBitmap
    const imageData = new ImageData(data, w, h);
    return window.createImageBitmap(
      imageData, 0, above, w, h - above - below);
  })
  .then(imageBitmap => {
    // Render the cropped image onto the canvas
    const canvas = $("#image_canvas")[0];
    const w = canvas.width = imageBitmap.width;
    const h = canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    $("#image_liner").height(h);

    $("#label_length_px").text(w);
    $("#label_length_mm").text(w * info.pixel_width_mm);

    $("#label_width_px").text(h);
    $("#label_width_mm").text(h * info.pixel_width_mm);
    if (h > info.printable_width_px) {
      $("#tape_div")
      .css("top", 0)
      .css("left", "0")
      .css("height", `${info.printable_width_px}px`)
      .show();
    } else
      $("#tape_div").hide();
  })
  .catch(error => {
    console.error("Rendering error", error);
  });
}

function onLabelChanged() {
  const content = $("#label_text").val();
  $("#review_div").html(content);
  refreshImage();
}

/**
 * Set the font family for the current selection (if there is one)
 * or the whole document
 */
function setFontFamily(font) {
  const classList = $('#review_div').attr('class').split(/\s+/);
  $.each(classList, function(index, item) {
    if (item.indexOf("font-family-") === 0) {
      $("#review_div").removeClass(item);
    }
  });

  refreshImage();
}

function setFontSize(size) {
  $("#review_div").css("font-size", `${size}px`);
  refreshImage();
}

/**
 * Set the rendering alpha threshold
 */
function setAlphaThreshold(th) {
  alphaThreshold = th;
  refreshImage();
}

/**
 * Set the rendeing colour threshold
 */
function setColourThreshold(th) {
  colourThreshold = th;
  refreshImage();
}

$(function() {
  $("#label_text").on("keyup", onLabelChanged);

  $("#select_font").on("change", function() {
    setFontFamily(this.value);
  });
  setFontFamily($("#select_font").val());
    
  $("#font-size").on("change", function() {
    setFontSize(this.value);
  });
  setFontSize($("#font-size").val());

  $("#print").on("click", function() {
    $.post("/ajax/print", { png: $("#image_canvas")[0].toDataURL() });
  });

  $("#alpha_threshold").on("change", function() {
    setAlphaThreshold(this.value);
  });
  setAlphaThreshold($("#alpha_threshold").val());

  $("#colour_threshold").on("change", function() {
    setColourThreshold(this.value);
  });
  setColourThreshold($("#colour_threshold").val());

  $("#eject").on("click", function() {
    $.post("/ajax/eject");
  });

  $.get("/ajax/info", info => {
    console.debug("Received INFO", info);
    setInfo(info);
  });

  onLabelChanged();
});

