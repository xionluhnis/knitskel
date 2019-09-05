// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const d3 = require('d3');
const Code = require('../machine/code.js');
const DATFile = require('../machine/datfile.js');

// - constants
const palette = DATFile.getDefaultPalette(true);
const space = 10;

// - data
let layout = null;
let blobURL = null;

function createElement(tag, clazz, text){
  let el = document.createElement(tag);
  if(Array.isArray(clazz)){
    for(let c of clazz)
      el.classList.add(c);
  } else
    el.className = clazz;
  if(text)
    el.textContent = text;
  return el;
}

function DATLayout(container){
  if(container instanceof HTMLCanvasElement)
    this.canvas = container;
  else {
    this.canvas = document.createElement('canvas');
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    container.appendChild(this.canvas);
  }
  this.dat = new DATFile();
  this.context = this.canvas.getContext('2d');
  this.width = this.canvas.clientWidth;
  this.height = this.canvas.clientHeight;
  this.zoom = d3.zoom();
  this.zoom.scaleExtent([0.2, 8]);
  this.zoom.on('zoom', () => {
    this.update();
  });
  this.updateExtent();
  // apply zoom on canvas
  d3.select(this.canvas).call(this.zoom);

  // mouse information
  this.canvas.addEventListener('mousemove', event => {
    this.clientX = event.clientX;
    this.clientY = event.clientY;
    this.mouseX  = event.offsetX;
    this.mouseY  = event.offsetY;
    this.updateInfo(event);
  });
  this.canvas.addEventListener('mouseout', () => {
    this.tooltip();
  });

  // tooltip
  this.tooltipContainer = createElement('div', ['tooltip', 'hidden']);
  container.appendChild(this.tooltipContainer);
}

// ###########################################################################
// ##### Transformations #####################################################
// ###########################################################################

DATLayout.prototype.getY = function(time){
  return -time * space;
};
DATLayout.prototype.getX = function(index){
  return index * space;
};

DATLayout.prototype.getPosition = function(time, index){
  return { x: this.getX(index), y: this.getY(time) };
};
/**
 * From mouse coordinates to bed index and time
 */
DATLayout.prototype.getMouseIndexAndTime = function(mouseX, mouseY){
  const transform = d3.zoomTransform(this.canvas);
  let mouseIndex = (mouseX - transform.x) / transform.k / space;
  let mouseTime = -(mouseY - transform.y) / transform.k / space;
  return { mouseIndex, mouseTime };
};

DATLayout.prototype.project = function(x, y){
  const transform = d3.zoomTransform(this.canvas);
  return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
};

DATLayout.prototype.isHidden = function(px, py, radius){
  if(radius){
    return this.isHidden(px - radius, py - radius)
        && this.isHidden(px - radius, py + radius)
        && this.isHidden(px + radius, py - radius)
        && this.isHidden(px + radius, py + radius);
  }
  let screenPos = this.project(px, py);
  return screenPos.x < 0
      || screenPos.y < 0
      || screenPos.x > this.width
      || screenPos.y > this.height;
};

// ###########################################################################
// ##### State Updates #######################################################
// ###########################################################################

const OptionName = {
  L17: "Racking adjustment",
  L14: "Elastic yarn advance",
  L13: "Transfer/holding",
  L12: "A-miss, split-to-hook",
  L11: "Roller speed (xfer)",
  L10: "Roller speed (knit)",
  L9: "DSCS",
  L7: "Reset adjust, optional stop, or stroke adjust",
  L6: "Speed (xfer)",
  L5: "Speed (knit)",
  L4: "Racking (left/right)",
  L3: "Racking (aligned/offset)",
  L2: "Racking (pitch)",
  L1: "Special process",
  R1: "Jump (inner)",
  R2: "Jump (outer)",
  R3: "Yarn carrier combination",
  R5: "Knit cancel and carrier move",
  R6: "Stitch number",
  R7: "Drop failure, sinker reset",
  R8: "Yarn in/out",
  R9: "Links process ignore",
  R10:"Yarn holding hook",
  R11:"Fabric presser",
  R13:"Stitch range, xfer cam stuff",
  R15:"Yarn inserting hook",
  R16:"Cleaner, disable leading xfer",
};

const MARGIN = DATFile.LEFT_SPACE - 5 - 20*2;

function capitalize(str){
  return str.replace(/^\w/, c => c.toUpperCase());
}

function getCodeNames(value, maxCount){
  if(!maxCount)
    maxCount = Infinity;
  let list = [];
  let formatted = () => {
    return list.map(name => {
      return capitalize(name.toLowerCase().replace(/_/g, ' '));
    });
  };
  for(let name in Code){
    let val = Code[name];
    if(val == value){
      list.push(name);
      if(list.length >= maxCount)
        return formatted();
    }
    else if(Array.isArray(val)){
      for(let i = 0; i < val.length; ++i){
        if(val[i] == value){
          list.push(name + ' (' + (i+1) + ' step' + (i ? 's' : '') + ')');
          if(list.length >= maxCount)
            return formatted();
          break;
        }
      }
    }
  }
  return formatted();
}

DATLayout.prototype.updateInfo = function(){
  let { mouseIndex, mouseTime } = this.getMouseIndexAndTime(this.mouseX, this.mouseY);
  let fullX = Math.round(mouseIndex);
  let fullY = Math.round(mouseTime);
  let line  = fullY - 5;
  let index = fullY * this.dat.fullWidth + fullX;

  if(fullX >= MARGIN && fullX < this.dat.fullWidth - MARGIN
  && fullY >= DATFile.BOTTOM_SPACE && fullY < this.dat.fullHeight - DATFile.TOP_SPACE){
    let value = this.dat.getPixel(fullY, fullX) || 0;
    let lineStart = this.dat.getLineIndex(line);
    if(index >= lineStart - 5 && index < lineStart + this.dat.width + 5){
      // within a line
      if(value){
        let info = '<span class="value">' + value + '</span>';
        // list of potential names
        let list = getCodeNames(value, 1).join(',');
        if(list.length)
          info += '<span class="names">' + list + '</span>';
        this.tooltip(info, true);
      } else{
        this.tooltip();
      }
    } else {
      let left = fullX < DATFile.LEFT_SPACE;
      let x = left ? DATFile.LEFT_SPACE - fullX - 4 : fullX - DATFile.LEFT_SPACE - this.dat.width - 3;
      let ox = (x - (x % 2)) / 2;
      let oid = (left ? 'L' : 'R') + ox;
      let name = OptionName[oid] || '';
      let info = '<span class="option-name">' + oid + ' ' + name + '</span>';
      if(x % 2){
        info += '<span class="option-value">' + value + '</span>';
      }
      this.tooltip(info, true);
    }
    this.canvas.style.cursor = 'help';
  } else {
    this.canvas.style.cursor = 'grab';
  }
};

DATLayout.prototype.centerLayout = function(){
  // find appropriate zoom level
  const zoom = Math.max(
      0.2, Math.min(
      8,
      Math.min(this.canvas.width / (this.dat.fullWidth * space),
               this.canvas.height / (this.dat.fullHeight * space) * 0.9)
  ));
  const newTransform = d3.zoomIdentity.translate(
    this.canvas.width / 2  - this.dat.fullWidth * space / 2 * zoom,
    this.canvas.height / 2 + this.dat.fullHeight * space / 2 * zoom
  ).scale(zoom);
  d3.select(this.canvas)
    .transition()
    .duration(750)
    .call(
        this.zoom.transform,
        newTransform
    );
};

/**
 * Update the pan/zoom extents
 */
DATLayout.prototype.updateExtent = function(){
  let w = this.dat.fullWidth * space;
  let h = this.dat.fullHeight * space;
  // extents = [ [left, top], [right, bottom] ]
  this.zoom.translateExtent([
    [ Math.min(-w * 0.5, -50),  Math.min(-h * 1.5, -50) ],
    [ Math.max(w * 1.5, 50),    Math.max(h * 0.5, 50) ]
  ]);
};

/**
 * Update the layout rendering
 */
DATLayout.prototype.update = function() {
  // update size
  let w = this.canvas.clientWidth;
  let h = this.canvas.clientHeight;
  if(h === 0){
    h = this.canvas.parentNode.clientHeight;
  }
  if(w != this.width || h != this.height){
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  // get transform for pan/zoom
  let transform = d3.zoomTransform(this.canvas);
  this.transform = transform;

  // clear background
  this.context.save();
  this.context.fillStyle = '#000';
  this.context.fillRect(0, 0, this.width, this.height);

  // draw warning/error messages
  // this.drawPreText(transform.k);

  // apply transformation to contexts
  this.context.translate(transform.x, transform.y);
  this.context.scale(transform.k, transform.k);

  // draw actual layout
  this.draw(transform.k);

  // restore previous transformation
  this.context.restore();

  // draw extra static text information on top
  // this.drawPostText(transform.k);
};

/**
 * Update the DAT information.
 * This trigger an update of the extents
 * as well as a redrawing of the layout.
 *
 * @param data the new DATFile
 * @param reset whether to recenter the layout
 */
DATLayout.prototype.updateData = function(dat, reset){
  this.dat = dat;
  this.updateExtent();
  if(reset)
    this.centerLayout();
  this.update();
};

// ###########################################################################
// ##### Drawing #############################################################
// ###########################################################################

DATLayout.prototype.draw = function(zoom){
  const ctx = this.context;
  const dat = this.dat;
  const pixelSize = space * 0.9;
  // draw all pixels using palette
  const length = dat.fullWidth * dat.fullHeight;
  for(let i = 0; i < length; ++i){
    let y = Math.floor(i / dat.fullWidth);
    let x = i % dat.fullWidth;
    let v = dat.data[i] || 0;
    if(!v)
      continue;
    let px = this.getX(x) - space * 0.5;
    let py = this.getY(y) - space * 0.5;
    // skip if out of view
    if(this.isHidden(px, py, space))
      continue;
    let r = palette[v], g = palette[v + 0x100], b = palette[v + 0x200];
    ctx.fillStyle = 'rgba(' + r + ', ' + g + ', ' + b + ', 255)';
    ctx.fillRect(px, py, pixelSize, pixelSize);
    // text
    if(zoom > 2){
      let factor = 2.1;
      ctx.fillStyle = 'rgba(' + Math.round(r / factor) + ', ' + Math.round(g / factor) + ', ' + Math.round(b / factor) + ', 255)';
      ctx.font = '4pt sans-serif';
      ctx.fillText('' + v, px, py + pixelSize / 2);
    }
    if(x == DATFile.LEFT_SPACE - 6){
      let dir = this.dat.getLineDirection(y - DATFile.BOTTOM_SPACE);
      if(typeof dir == 'string')
        dir = Code.DIR_FROM_STR[dir];
      if(dir == Code.RIGHT){
        ctx.beginPath();
        ctx.fillStyle = '#222';
        ctx.moveTo(px + space, py);
        ctx.lineTo(px + space * 3, py);
        ctx.lineTo(px + space * 4, py + space/2);
        ctx.lineTo(px + space * 3, py + space);
        ctx.lineTo(px + space, py + space);
        ctx.fill();
      }
    } else if(x == DATFile.LEFT_SPACE + this.dat.width + 5){
      let dir = this.dat.getLineDirection(y - DATFile.BOTTOM_SPACE);
      if(typeof dir == 'string')
        dir = Code.DIR_FROM_STR[dir];
      if(dir == Code.LEFT){
        ctx.beginPath();
        ctx.fillStyle = '#223';
        ctx.moveTo(px, py);
        ctx.lineTo(px - 2 * space, py);
        ctx.lineTo(px - 3 * space, py + space/2);
        ctx.lineTo(px - 2 * space, py + space);
        ctx.lineTo(px, py + space);
        ctx.fill();
      }
    }
  } // endfor i < length
};

// ###########################################################################
// ##### Tooltip #############################################################
// ###########################################################################

DATLayout.prototype.tooltip = function(message, html){
  const t = this.tooltipContainer;

  // clear current tooltip
  t.classList.add('hidden');

  // clear content
  while(t.firstChild)
    t.removeChild(t.firstChild);

  // clear pending timeout
  let timeout = t.getAttribute('data-timeout');
  clearTimeout(timeout);

  // potentially trigger new tooltip
  if(message){
    this.showTooltip(message, html);
    // timeout = setTimeout(() => {
      // this.showTooltip(message, html);
    // }, );
    // t.setAttribute('data-timeout', timeout);
  }
};

DATLayout.prototype.showTooltip = function(message, html){
  const t = this.tooltipContainer;
  if(html)
    t.innerHTML = message;
  else
    t.textContent = message;

  // make visible near mouse
  t.classList.remove('hidden');
  let width = t.offsetWidth + 4;
  let height = t.offsetHeight + 4;
  let winWidth = window.innerWidth;
  let winHeight = window.innerHeight;
  let margin = 20;

  // positioning
  if((winWidth - this.clientX) < width + margin){
    t.style.left = (winWidth - width - margin) + 'px';
  } else {
    t.style.left = (this.clientX + margin) + 'px';
  }
  if((winHeight - this.clientY) < height + margin){
    t.style.top = (winHeight - height - margin) + 'px';
  } else {
    t.style.top = (this.clientY + margin) + 'px';
  }
};

// ###########################################################################
// ##### Exports #############################################################
// ###########################################################################

function saveDAT(dat){
  let margin = document.getElementById('dat_margin').checked ? 20 : 0;
  let blob = new Blob([dat.toBuffer(margin)]);
  if(blobURL){
    URL.revokeObjectURL(blobURL);
    blobURL = null;
  }
  blobURL = URL.createObjectURL(blob);
  let save = document.getElementById('output_save');
  save.download = 'skeleton.dat';
  save.href = blobURL;
}

function drawDAT(dat, reset){
  if(!layout){
    let canvas = document.getElementById('output-dat');
    layout = new DATLayout(canvas);
    // initial zoom stuff
    setTimeout(() => {
      layout.centerLayout();
    }, 500);
  }
  layout.updateData(dat, reset);

  /*
  canvas.onclick = function(){
    if(!offlineCanvas)
      offlineCanvas = document.createElement('canvas');
    const scale = 20;
    offlineCanvas.width  = canvas.width  * scale;
    offlineCanvas.height = canvas.height * scale;
    canvasDAT(dat, offlineCanvas.getContext('2d'), scale);
    let url = offlineCanvas.toDataURL('image/png');
    let win = window.open();
    while(win.document.firstChild)
      win.document.removeChild(win.document.firstChild);
    win.document.write('<img src="' + url + '" style="width: 100%; height: auto; background: #666;" />');
  };
  */
}

module.exports = { drawDAT, saveDAT };
