// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const Canvas2SVG = require('canvas2svg');
const d3 = require('d3');
const JSZip = require('jszip');
const assert = require('../assert.js');
const { Action } = require('../ir.js');
const Bed = require('../bed.js');
const env = require('../env.js');
const { nodeColor, patternColor } = require('./colors.js');

// - constants
const spaceX = 10;
const spaceY = 20;
const bedSpaceX = 5;
const bedSpaceY = 8;
const squareSize = Math.min(spaceX, spaceY) * 0.666;

// - data
let layout = null;

function createCanvas(parent, prepend){
  assert(!(parent instanceof HTMLCanvasElement),
    'Layout requires a container (not a canvas)');
  let canvas = document.createElement('canvas');
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
  if(prepend)
    parent.insertBefore(canvas, parent.firstChild);
  else
    parent.appendChild(canvas);
  return canvas;
}

function Layout(container){
  this.canvas = createCanvas(container);
  this.backCanvas = createCanvas(container, true);
  this.frontCanvas = createCanvas(container);
  this.data = { width: 0, length: 0, timeline: [] };
  this.compactData = {};
  this.assertErrors = [];
  this.nodeOrder = [[], []];
  this.sides = ['front', 'back'];
  this.context = this.canvas.getContext('2d');
  this.backContext = this.backCanvas.getContext('2d');
  this.frontContext = this.frontCanvas.getContext('2d');
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

  // update on side change
  this.invertX = false;
  let sideMode = document.getElementById('sideMode');
  sideMode.addEventListener('change', () => {
    sideMode.parentNode.classList.remove('front', 'back', 'front-back', 'back-front');
    sideMode.parentNode.classList.add(sideMode.value);
    this.updateSides();
    this.update();
  });

  // update on show options
  for(let showOpt of ['showBeds', 'showBG', 'showFlow', 'showLabels', 'showNodes']){
    this[showOpt] = true;
    document.getElementById(showOpt).addEventListener('click', () => {
      this[showOpt] = !this[showOpt];
      this.update();
    });
  }

  // update on compact
  this.compact = false;
  document.getElementById('compact').addEventListener('click', () => {
    this.compact = !this.compact;
    require('./skeleton.js').renderSkeleton(true);
  });

  // build interaction logic
  this.startInteraction(container);
}

Layout.prototype.enablePaning = function(){
  d3.select(this.canvas).call(this.zoom);
};

Layout.prototype.disablePaning = function(){
  // @see https://stackoverflow.com/questions/13713528/how-to-disable-pan-for-d3-behavior-zoom
  d3.select(this.canvas)
    .on('mousedown.zoom', null);
    // .on('mousemove.zoom', null)
    // .on('mouseup.zoom', null)
    // .on('touchstart.zoom', null)
    // .on('touchmove.zoom', null)
    // .on('touchend.zoom', null);
};

// ###########################################################################
// ##### Transformations #####################################################
// ###########################################################################

Layout.prototype.getY = function(time, s){
  return -time * spaceY - s * bedSpaceY;
};
Layout.prototype.getX = function(index, s){
  return (this.invertX ? this.data.width - 1 - index : index) * spaceX + s * bedSpaceX;
};

Layout.prototype.getPosition = function(time, index, s){
  assert(s !== undefined, 'You must specify sidedness argument s');
  return { x: this.getX(index, s), y: this.getY(time, s) };
};
/**
 * From mouse coordinates to bed index and time
 */
Layout.prototype.getMouseIndexAndTime = function(mouseX, mouseY){
  const transform = this.transform; // d3.zoomTransform(this.canvas);
  let mouseIndex;
  if(this.sides[0] == 'back')
    mouseIndex = this.data.width - 1 - (mouseX - transform.x) / transform.k / spaceX;
  else
    mouseIndex = (mouseX - transform.x) / transform.k / spaceX;
  let mouseTime = -(mouseY - transform.y) / transform.k / spaceY;
  return { mouseIndex, mouseTime };
};
Layout.prototype.project = function(x, y){
  const transform = this.transform; // d3.zoomTransform(this.canvas);
  return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
};
Layout.prototype.projectY = function(y){
  const transform = this.transform; // d3.zoomTransform(this.canvas);
  return y * transform.k + transform.y;
};
Layout.prototype.projectX = function(x){
  const transform = this.transform; // d3.zoomTransform(this.canvas);
  return x * transform.k + transform.x;
};

Layout.prototype.isHidden = function(px, py, radius){
  if(radius){
    return this.isHidden(px - radius, py - radius)
        && this.isHidden(px - radius, py + radius)
        && this.isHidden(px + radius, py - radius)
        && this.isHidden(px + radius, py + radius);
  }
  let screenPos = this.project(px, py);
  return screenPos.x < -spaceX
      || screenPos.y < -spaceY
      || screenPos.x > this.width + spaceX
      || screenPos.y > this.height + spaceY;
};

Layout.prototype.isLineHidden = function(py) {
  let sy = this.projectY(py);
  return sy < -spaceY || sy > this.height + spaceY;
};

Layout.prototype.isColumnHidden = function(px) {
  let sx = this.projectX(px);
  return sx < -spaceX || sx > this.width + spaceX;
};

// ###########################################################################
// ##### State Updates #######################################################
// ###########################################################################

Layout.prototype.centerLayout = function(){
  // find appropriate zoom level
  const zoom = Math.max(
      0.2, Math.min(
      8,
      Math.min(this.canvas.width / (this.data.width * spaceX),
               this.canvas.height / (this.data.length * spaceY) * 0.9)
  ));
  const newTransform = d3.zoomIdentity.translate(
    this.canvas.width / 2  - this.data.width * spaceX / 2 * zoom,
    this.canvas.height / 2 + this.data.length * spaceY / 2 * zoom
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
 * Update sides to visualize
 */
Layout.prototype.updateSides = function(){
  this.sides = document.getElementById('sideMode').value.split('-');
  for(let side of this.sides)
    assert(['front', 'back'].includes(side), 'Invalid side', side);
  this.invertX = this.sides[0] == 'back';
};

/**
 * Update the pan/zoom extents
 */
Layout.prototype.updateExtent = function(){
  let s = this.sides.length - 1;
  let w = this.data.width * spaceX + s * bedSpaceX;
  let h = this.data.length * spaceY + s * bedSpaceY;
  // locations
  // let dw = (w - this.width) / 2;
  // let dh = -(h - this.height) / 2;
  // extents = [ [left, top], [right, bottom] ]
  this.zoom.translateExtent([
    [ Math.min(-w * 0.5, -50),  Math.min(-h * 1.5, -50) ],
    [ Math.max(w * 1.5, 50),    Math.max(h * 0.5, 50) ]
  ]);
  // unbind previous behaviour
  // d3.select(this.canvas).on('.zoom', null);
  // create new zoom behaviour
  // d3.select(this.canvas).call(this.zoom);
};

/**
 * Update the layout rendering
 */
Layout.prototype.update = function() {
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
    this.backCanvas.width = w;
    this.backCanvas.height = h;
    this.frontCanvas.width = w;
    this.frontCanvas.height = w;
  }
  for(let cvs of [this.canvas, this.backCanvas, this.frontCanvas]){
    if(cvs.width != w)
      cvs.width = w;
    if(cvs.height != h)
      cvs.height = h;
  }

  // get transform for pan/zoom
  let transform = d3.zoomTransform(this.canvas);
  this.transform = transform;

  // draw highlight first
  this.drawHighlight();
  // draw main content then
  this.drawContent();
};

/**
 * Export SVG of scene
 */
Layout.prototype.exportSVG = function(...args){
  const fixContext = (ctx) => {
    if(!ctx.setLineDash)
      ctx.setLineDash = () => {};
  };
  // switch canvas contexts
  let names = ['context', 'frontContext', 'backContext'];
  let svg = {};
  let tmp = {};
  for(let ctxName of names){
    tmp[ctxName] = this[ctxName];
    svg[ctxName] = new Canvas2SVG(this.canvas.clientWidth, this.canvas.clientHeight);
    this[ctxName] = svg[ctxName];
    fixContext(this[ctxName]);
  }

  // SVG stuff may not be supported
  // = we try, but may fail
  let failed = false;
  try {
    // draw to SVG contexts
    let transform = d3.zoomTransform(this.canvas);
    this.transform = transform;
    this.drawHighlight();
    this.drawContent();

    // export SVGs
    for(let ctxName of names){
      this[ctxName] = tmp[ctxName];
      svg[ctxName] = svg[ctxName].getSerializedSvg(true, ...args);
    }
  } catch(err){
    // some unsupported properties
    console.error(err);
    failed = true;
  }

  // reset contexts, always
  for(let ctxName of names){
    this[ctxName] = tmp[ctxName];
  }

  // abort if drawing or serialization failed
  if(failed)
    return;

  // export SVG data
  let zip = new JSZip();
  for(let ctxName of names)
    zip.file(ctxName + '.svg', svg[ctxName]);
  zip.generateAsync({ type: 'blob' }).then(content => {
    // @see https://stackoverflow.com/questions/13405129/javascript-create-and-save-file#30832210
    let a = document.createElement('a');
    let url = URL.createObjectURL(content);
    a.href = url;
    a.download = 'scene.zip';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  });
};

/**
 * Update the time needle information.
 * This trigger an update of the sides and extents
 * as well as a redrawing of the layout.
 *
 * @param data the new time needle bed
 * @param reset whether to recenter the layout
 */
Layout.prototype.updateData = function(data, reset){
  this.data = data;
  // simulate
  this.data.simulate();

  // compact data if requested
  if(this.compact){
    this.data = this.data.compact();
    this.compact = {
      startingMap: {}
    };
    for(let gid of this.data.groups){
      let groupData = this.data.groupMap[gid];
      let startTime = groupData.startTime;
      if(startTime in this.compact.startingMap)
        this.compact.startingMap[startTime].push(groupData);
      else
        this.compact.startingMap[startTime] = [ groupData ];
    }
  }
  this.assertErrors = assert.errorList();
  assert.clear();

  // clear selection
  this.clearSelection();

  // update node traversal order
  this.nodeOrder[0] = this.data.groups.slice();
  this.nodeOrder[1] = this.data.groups.slice();
  for(let i = 0; i < 2; ++i){
    this.nodeOrder[i].sort((g1, g2) => {
      let s1 = this.data.groupMap[g1].groups[0].side();
      let s2 = this.data.groupMap[g2].groups[0].side();
      return i == 0 ? s2 - s1 : s1 - s2;
    });
  }
  this.updateSides();
  this.updateExtent();
  if(reset)
    this.centerLayout();
  this.updateActions();
  this.update();
};

/**
 * Update the current highlight selection
 */
Layout.prototype.updateHighlight = function(){
  const nbed = this.data.at(this.targetTime);
  const side = Bed.SIDE_FROM_STR[this.sides[0]];
  const groups = nbed.groupsAt(this.targetIndex, side);
  // group highlight
  if(!groups.length){
    // clear highlight and update if it was not empty before
    if(this.highlight.length){
      this.highlight = [];
      this.highlightMap = {};
      this.drawHighlight();
      return true;
    }
  } else {
    // update if the groups differ
    if(this.highlight.length != groups.length
    || this.highlight.some(g => !groups.includes(g))){
      // store the node groups (not course ones)
      this.highlight = groups.map(g => g.parent);
      this.highlightMap = {};
      // map maps node group ids to the target course group
      for(let i = 0; i < groups.length; ++i)
        this.highlightMap[groups[i].parent.id] = groups[i];
      this.drawHighlight();
      return true;
    }
  }

  // HTML highlight (groups + nodes)
  /*
  if(groups.length){
    const stitch = nbed.beds[side][this.targetIndex];
    this.tooltip({ groups: groups, stitch: stitch });
  } else {
    this.tooltip();
  }
  */
  return false;
};

Layout.prototype.clearSelection = function(){
  this.selection = [];
  this.selectionMap = {};
};

/**
 * Update the current selection.
 * Shift keeps the previous selection into account.
 *
 * @param event the MouseEvent that triggered the seleciton
 */
Layout.prototype.updateSelection = function(event) {
  const nbed = this.data.at(this.targetTime);
  const side = Bed.SIDE_FROM_STR[this.sides[0]];
  const groups = nbed.groupsAt(this.targetIndex, side);
  if(!event || groups.length === 0){
    // clearing the selection
    if(this.selection.length){
      this.clearSelection();
      this.update();
    }
  } else {
    // new selection
    if(event.shiftKey){
      // add / remove current
      for(let g of groups){
        if(g.parent.id in this.selectionMap){
          delete this.selectionMap[g.parent.id];
          this.selection.splice(this.selection.indexOf(g.parent), 1);
        } else {
          this.selectionMap[g.parent.id] = g;
          this.selection.push(g.parent);
        }
      }
    } else {
      // reset to current
      this.selection = groups.map(g => g.parent);
      this.selectionMap = {};
      for(let g of groups)
        this.selectionMap[g.parent.id] = g;
      if(this.selection.length == 1){
        let g = this.selection[0].first();
        if(g.shape){
          if(env.isPanelOpen('params')){
            const selectNode = require('./params');
            selectNode(g.shape.node);
          }
        }
      }
    }
  }
};

// ###########################################################################
// ##### Drawing Highlights ##################################################
// ###########################################################################

Layout.prototype.drawHighlight = function(){
  const ctx = this.backContext;
  const transform = this.transform;

  // draw back highlights

  // clear background
  ctx.save();
  if(this.showBG){
    ctx.fillStyle = '#eee';
    ctx.fillRect(0, 0, this.width, this.height);
  } else {
    ctx.clearRect(0, 0, this.width, this.height);
  }

  // apply transformation to contexts
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  // draw layout nodes with their name / identifier
  // use zoom to set opacity (linearly?)
  this.drawNodes(1.0 - transform.k / 8.0);

  // draw node labels
  this.drawLabels();

  // restore previous transformation
  ctx.restore();

  // draw front highlights
  const frontCtx = this.frontContext;
  frontCtx.save();
  frontCtx.clearRect(0, 0, this.width, this.height);
  frontCtx.translate(transform.x, transform.y);
  frontCtx.scale(transform.k, transform.k);
  // draw actions in front
  this.drawAction();
  // restore transformation
  frontCtx.restore();
};

Layout.prototype.getRowExtents = function(grp, time){
  if(time === undefined)
    time = grp.time;
  const { min, max } = grp.extents();
  const firstSide = Bed.SIDE_FROM_STR[this.sides[0]];
  const off = 0.25;
  let sideDX1 = 0, sideDY1 = 0;
  if(this.sides.length == 2){
    if(grp.side() != firstSide){
      sideDX1 += bedSpaceX;
      sideDY1 += bedSpaceY;
    }
  }
  let nl, nr;
  if(this.invertX){
    nl = this.data.width - 1 - max;
    nr = this.data.width - 1 - min;
  } else {
    nl = min;
    nr = max;
  }
  let left    = (nl - off) * spaceX;
  let right   = sideDX1 + (nr + off) * spaceX;
  let bottom  = -(time - off) * spaceY;
  let top     = -(time + off) * spaceY - sideDY1;
  return { left, right, bottom, top };
};

Layout.prototype.drawRowHighlight = function(ctx, grp, color, time){
  if(time === undefined)
    time = grp.time;
  const { left, right, bottom, top } = this.getRowExtents(grp, time);
  ctx.beginPath();
  ctx.moveTo(left,  bottom);
  ctx.lineTo(right, bottom);
  ctx.lineTo(right, top);
  ctx.lineTo(left,  top);
  ctx.closePath();
  ctx.fillStyle = color; // nodeColor(shape.node);
  ctx.fill();
  ctx.stroke();
  return { left, right, bottom, top };
};

/**
 * Draw the node groups with special treatment for the highlight and selection
 *
 * @param alpha the alpha value of the drawing
 */
Layout.prototype.drawNodes = function(alpha){
  if(!this.showNodes)
    return;
  if(!alpha && this.highlight.length === 0 && this.selection.length === 0)
    return; // skip if not visible
  const ctx = this.backContext;
  const invertX = this.invertX;
  const firstSide = Bed.SIDE_FROM_STR[this.sides[0]];
  const nodeOrder = this.nodeOrder[firstSide];
  for(let i = 0; i < nodeOrder.length; ++i){
    let thisAlpha = alpha;
    let { shape, groups } = this.data.groupMap[nodeOrder[i]];
    const side = groups[0].side();
    let sideDX0 = 0, sideDY0 = 0;
    let sideDX1 = 0, sideDY1 = 0;
    if(this.sides.length == 2){
      if(side == Bed.BOTH_SIDES){
        sideDX1 += bedSpaceX;
        sideDY1 += bedSpaceY;
      } else if(side == Bed.SIDE_FROM_STR[this.sides[1]]){
        sideDX0 += bedSpaceX;
        sideDY0 += bedSpaceY;
        sideDX1 += bedSpaceX;
        sideDY1 += bedSpaceY;
      }
    } else {
      if(side != Bed.BOTH_SIDES && side != firstSide){
        // wrong side
        thisAlpha *= 0.5; // change opacity
      }
    }
    // use square of alpha (to ramp down quickly)
    thisAlpha *= thisAlpha * 0.7;
    const color = shape ?
        nodeColor(shape.node, thisAlpha) :
        'rgb(255, 255, 255)';

    // draw group outline
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.strokeStyle = shape ? nodeColor(shape.node) : color;
    ctx.lineWidth = 2;
    const off = shape ? 0.25 : 0;
    // going upwards on the right
    for(let j = 0; j < groups.length; ++j){
      const g = groups[j];
      let nx;
      if(invertX){
        nx = this.data.width - 1 - g.min(); // right side = first offset, inverted
      } else {
        nx = g.max(); // right side = last offset
      }
      const x = sideDX1 + (nx + off) * spaceX;
      const y = -g.time * spaceY;
      if(j == 0)
        ctx.moveTo(x, y - (sideDY0 - spaceY * 0.25));
      ctx.lineTo(x, y - sideDY1);
      if(j == groups.length - 1)
        ctx.lineTo(x, y - (sideDY1 + spaceY * 0.25));
    }
    // going downward on the left
    for(let j = groups.length - 1; j >= 0; --j){
      const g = groups[j];
      let nx;
      if(invertX) // left side = last offset, inverted
        nx = this.data.width - 1 - g.max();
      else // left side = first offset
        nx = g.min();
      let x = sideDX0 + (nx - off) * spaceX;
      let y = -g.time * spaceY;
      if(j == groups.length - 1)
        ctx.lineTo(x, y - (sideDY1 + spaceY * 0.25)); // top-left
      ctx.lineTo(x, y - sideDY0); // center-left
      if(j == 0)
        ctx.lineTo(x, y - (sideDY0 - spaceY * 0.25)); // bottom-left
    }
    ctx.closePath();
    ctx.fill();

    // highlighting
    const gpid = groups[0].parent.id;
    if(gpid in this.highlightMap){
      ctx.stroke();

      // pseudo interface
      if(shape && this.shouldShowInterfaces(shape)){
        // only for node groups
        const t = this.targetTime;
        let g = null;
        if(t == groups[0].time)
          g = groups[0];
        else if(t == groups[groups.length - 1].time)
          g = groups[groups.length - 1];
        // highlight course
        if(g){
          this.drawRowHighlight(ctx, g, 'rgb(220, 255, 128)');
        }
      }

    } else if(gpid in this.selectionMap){
      ctx.strokeStyle = '#000';
      ctx.stroke();
    } else if(this.compact){
      assert(shape, 'Should only have active groups');
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.stroke();
    }
  }
};

Layout.prototype.drawLabel = function(ctx, t, grp, stack){
  const shift = t * this.transform.k * spaceY;
  // note: extent should not include hidden beds (inactive, non-suspending)
  const extent = this.data.groupMap[grp.id].groups.length * this.transform.k * spaceY;
  const shape = this.data.groupMap[grp.id].shape;
  const shortName = '#' + shape.node.id;
  const longName = shortName + ' - ' + shape.node.name;
  // label background
  ctx.fillStyle = '#fff';
  ctx.fillRect(shift, -(stack+1) * 16, extent, 16);
  // label text
  ctx.font = '16px Arial';
  ctx.fillStyle = this.highlightMap[grp.id] ? '#000' : '#aaa';
  for(let name of [longName, shortName]){
    const textWidth = ctx.measureText(name).width;
    // only show if short enough
    if(textWidth <= extent){
      ctx.fillText(name, shift, -stack * 16);
      break;
    }
  }
};

Layout.prototype.drawLabels = function(){
  if(!this.showLabels)
    return;
  const ctx = this.backContext;
  const margin = 2;
  // extents
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, this.transform.x, this.transform.y);
  ctx.translate(-margin * spaceX * this.transform.k, 0);
  ctx.rotate(-Math.PI / 2);
  ctx.translate(0, -8);
  let grp = null;
  let stack = 0;
  for(let t = 0; t < this.data.length; ++t){
    const nbed = this.data.timeline[t];
    // draw labels of active groups
    // at their beginning bed location
    if(!nbed.activeGroup)
      continue; // skip if no active group
    if(this.compact){
      // multiple active groups
      if(t in this.compact.startingMap){
        let groups = this.compact.startingMap[t];
        for(let i = 0; i < groups.length; ++i, stack = (stack + 1) % 5){
          this.drawLabel(ctx, t, groups[i].groups[0].parent,
            groups.length > 5 ? i : stack);
        }
      }
    } else if(grp != nbed.activeGroup.parent){
      // difference in active group => new group / label
      grp = nbed.activeGroup.parent;
      this.drawLabel(ctx, t, grp, stack);
      // change stack level
      stack = (stack + 1) % 3;
    }
  }
  ctx.restore();
};


/**
 * Draw the whole layout
 *
 * @parma zoom the zoom level within [0.2; 8]
 */
Layout.prototype.drawContent = function() {
  const ctx = this.context;
  const transform = this.transform;
  const zoom = this.transform.k;
  const showStitches = zoom >= 0.5;
  const showYarn  = zoom >= 2;
  const showInstr = zoom >= 4;

  // clear background
  ctx.save();
  ctx.clearRect(0, 0, this.width, this.height);

  // draw warning/error messages
  this.drawPreText(transform.k);

  // apply transformation to contexts
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  // draw knitting bed
  let showBeds = this.showBeds;
  if(showYarn && this.showFlow)
    showBeds = false;
  if(showBeds)
    this.drawBeds();

  // draw yarn
  if(showYarn){
    this.drawYarn();
  }

  // draw stitches
  if(showStitches)
    this.drawStitches(showInstr, showYarn);

  // restore previous transformation
  ctx.restore();

  // draw extra static text information on top
  this.drawPostText(transform.k);
};

/**
 * Draw the beds structure
 */
Layout.prototype.drawBeds = function(){
  let ctx = this.context;
  // per side
  const margin = 2;
  const w = this.data.width * spaceX;
  const h = this.data.length * spaceY;
  for(let s = this.sides.length - 1; s >= 0; --s){
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = s ? '#ddd' : '#bbb';
    // extents
    let startX = w + margin * spaceX + s * bedSpaceX;
    let endX   = - margin * spaceX + s * bedSpaceX;
    let startY = margin * spaceY - s * bedSpaceY;
    let endY   = - h - margin * spaceY - s * bedSpaceY;
    // beds
    let prevBed = this.data.at(-1);
    // per-bed (over time)
    for(let t = 0; t < this.data.length; ++t){
      let y = -t * spaceY - s * bedSpaceY;
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      // bed boundaries
      const currBed = this.data.timeline[t];
      if(this.compact){
        // multiple active groups
        if(t in this.compact.startingMap){
          ctx.lineTo(endX - margin * spaceX * this.compact.startingMap[t].length, y);
        }
      } else if(currBed.activeGroup){
        // note: when buggy layout, some beds may not have active groups
        assert(!prevBed.activeGroup || prevBed.activeGroup.parent,
          'Invalid active group without parent');
        if(!prevBed.activeGroup || prevBed.activeGroup.parent != currBed.activeGroup.parent){
          ctx.lineTo(endX - margin * spaceX, y);
        }
      }
      prevBed = currBed;
    }
    // per-needle (over width)
    for(let n = 0; n < this.data.width; ++n){
      let x = n * spaceX + s * bedSpaceX;
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    ctx.stroke();
  }
};

Layout.prototype.drawYarnOf = function(ctx, t, g, currBed, prevBed, firstSide, singleSide){
  // check for empty course
  // note: suspended stitches do not show yarn!
  const crs = g.course;
  if(crs.isEmpty())
    return;

  // check visibility of row
  const y0 = this.getY(t, 0);
  const y1 = this.getY(t, 1);
  if(this.isLineHidden(y0) && this.isLineHidden(y1))
    return; // nothing to do as it's not visible

  // draw the yarn
  for(let i = 0; i < crs.stitches.length; ++i){
    const curr = crs.stitches[i];
    // exclude suspended stitches
    // if(currBed.isSuspended(curr))
      // continue;
    // else draw filtered course connections
    const { index, side } = currBed.needleOf(curr);
    // skip nodes of the second side if only showing one side
    if(singleSide && side != firstSide)
      continue;
    // compute position of that node
    const { x, y } = this.getPosition(t, index, side != firstSide);
    if(this.isColumnHidden(x))
      continue;
    // draw filtered course connections
    for(let other of curr.courses){
      // check relation to this bed
      if(currBed.hasStitch(other)){
        // special test for suspended stitches
        // directly accept if suspended on this, but not on previous
        if(currBed.isSuspended(other) && !prevBed.isSuspended(other)){
          const { index: oIndex, side: oSide } = prevBed.needleOf(other);
          const { x: ox, y: oy } = this.getPosition(t-1, oIndex, oSide != firstSide);
          ctx.moveTo(x, y);
          ctx.lineTo(ox, oy);
        } else {
          // same bed => draw if and only if
          //    - further on a direction or
          //    - bed transition from first side
          //    - transition between suspended and non-suspended stitches
          //      => no need to check suspended state
          const { index: oIndex, side: oSide } = currBed.needleOf(other);
          if((side == firstSide && side != oSide) // transition between beds, from first one
          || (index > oIndex)){ // other has smaller index
            const { x: ox, y: oy } = this.getPosition(t, oIndex, oSide != firstSide);
            ctx.moveTo(x, y);
            ctx.lineTo(ox, oy);
          }
        }
      } else if(prevBed.hasStitch(other)){
        // previous bed => draw course
        const { index: oIndex, side: oSide } = prevBed.needleOf(other);
        const { x: ox, y: oy } = this.getPosition(t-1, oIndex, oSide != firstSide);
        ctx.moveTo(x, y);
        ctx.lineTo(ox, oy);
      }
      // else we don't draw it (because drawn from another stitch)
    } // endfor other
  } // endfor i < stitches.length
};

Layout.prototype.drawYarn = function(){
  const ctx = this.context;
  const firstSide = Bed.SIDE_FROM_STR[this.sides[0]];
  const singleSide = this.sides.length == 1;
  let prevBed = this.data.at(-1);
  // draw yarn course
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(100, 150, 255, 0.7)';
  for(let t = 0; t < this.data.length; ++t){
    let currBed = this.data.timeline[t];
    if(this.compact){
      for(let g of currBed.groups)
        this.drawYarnOf(ctx, t, g, currBed, prevBed, firstSide, singleSide);
    } else if(currBed.activeGroup){
      this.drawYarnOf(ctx, t, currBed.activeGroup, currBed, prevBed, firstSide, singleSide);
    }
    prevBed = currBed;
  } // endfor t
  ctx.stroke();
};

Layout.prototype.drawFlow = function(){
  // only draw wales for first side (s=0)
  // const waleColor = 'rgba(255, 179, 71, ' + (s ? 0.2 : 0.5) + ')';
  const firstSide = Bed.SIDE_FROM_STR[this.sides[0]];
  const ctx = this.context;
  // ctx.beginPath();
  // ctx.strokeStyle = 'rgba(255, 179, 71, 0.5)';
  let y = 0;
  let prev = this.data.at(-1);
  for(let t = 0; t < this.data.length; ++t, y -= spaceY){
    const nbed = this.data.timeline[t];
    for(let a = 0; a < nbed.actions.length; ++a){
      const action = nbed.actions[a];
      const { source, targets } = action;
      if(source.side != firstSide)
        continue; // skip second side
      const x = this.getX(source.index, 0);
      for(let i = 0; i < targets.length; ++i){
        const { index, side } = targets[i];
        const { x: ox, y: oy } = this.getPosition(t+1, index, side != firstSide);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 179, 71, 0.5)';
        const kickback = i > 0 && action.increaseType == Action.KICKBACK;
        ctx.setLineDash(kickback ? [2, 1] : []);
        ctx.moveTo(x, y);
        ctx.lineTo(ox, oy);
        ctx.stroke();
      } // endfor i in targets
    } // endfor sid of actionMap
    // suspended wales
    const next = nbed.next();
    for(let stitch of nbed.suspendedStitches()){
      // if(!prev.hasStitch(stitch))
        // continue;
      if(!next.hasStitch(stitch)){
        let { index: idx0, side: s0 } = nbed.needleOf(stitch);
        if(s0 != firstSide)
          continue; // skip back suspended stitches
        let t0 = this.data.stitchMap[stitch.id].time;
        for(let waleStitch of stitch.wales){
          if(!next.hasStitch(waleStitch))
            continue;
          // show wale
          // XXX this assumes the stitch stays suspended at the same location
          // but it's possible for it to move in a more general optimization setting
          let { x: x0, y: y0 } = this.getPosition(t0, idx0, 0);
          let { index: idx1, side: s1 } = next.needleOf(waleStitch);
          let { x: x1, y: y1 } = this.getPosition(t + 1, idx1, s1 === firstSide ? 0 : 1);
          ctx.beginPath();
          ctx.setLineDash([1, 2]);
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
      // else it's from suspended to suspended => nothing interesting
    }
    prev = nbed;
  } // endfor t
  // ctx.stroke();
};

Layout.prototype.drawSimulation = function(){
  const firstSide = Bed.SIDE_FROM_STR[this.sides[0]];
  const ctx = this.context;
  const sources = [ 'warnings', 'errors' ];
  const colors = { 'warnings': '#666', 'errors': '#000' };
  for(let s = 0; s < sources.length; ++s){
    let sourceName = sources[s];
    let list = this.data[sourceName];
    if(list.length === 0)
      continue;
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = colors[sourceName];
    ctx.fillStyle = colors[sourceName];
    for(let i = 0; i < list.length; ++i){
      let err = list[i];
      if(err.side !== firstSide)
        continue;
      let { x, y } = this.getPosition(err.time, err.index, 0);
      ctx.moveTo(x, y);
      ctx.fillRect(
        x - squareSize * 0.5,
        y - squareSize * 0.5,
        squareSize, squareSize
      );
      if(err.flow){
        for(let { stitch, time } of err.flow.pointers){
          let bed = this.data.timeline[time];
          let { index, side } = bed.needleOf(stitch);
          let { x: ox, y: oy } = this.getPosition(time, index, side == firstSide ? 0 : 1);
          ctx.moveTo(x, y);
          ctx.lineTo(ox, oy);
        } // endfor
      } // endif
    } // endfor i in list
    ctx.stroke();
  } // endfor s in sources
  ctx.setLineDash([]);
};

const instrImages = [
  'K', 'P', 'T', 'M', 'FR', 'FR', 'FL', 'FL',
  'BR', 'BR', 'BL', 'BL', 'XRp', 'XRm', 'XLp', 'XLm', 'S'
].map(str => {
  let img = new Image();
  img.src = 'assets/instructions/' + str + '.png';
  return img;
});

Layout.prototype.drawStitches = function(showInstr, showYarn){
  let ctx = this.context;
  // second bed before the first
  const invertX = this.invertX;
  for(let s = this.sides.length - 1; s >= 0; --s){
    // draw flow before first side
    if(s == 0 && showYarn && this.showFlow)
      this.drawFlow();
    if(s == 0)
      this.drawSimulation();
    let side = this.sides[s];
    let y = -s * bedSpaceY;
    for(let t = 0; t < this.data.length; ++t, y -= spaceY){
      let bed = this.data.timeline[t].bed[side];
      let x   = s * bedSpaceX;
      let fx  = 1;
      if(invertX){
        // invert x axis (draw from right side)
        x += (this.data.width - 1) * spaceX;
        fx = -1;
      }
      for(let i = 0; i < bed.length; ++i, x += fx * spaceX){
        // check if region is visible
        // XXX use isLineHidden and isColumnHidden instead
        if(this.isHidden(x, y, squareSize * 0.5))
          continue;
        let stitch = bed[i];
        if(stitch && !Array.isArray(stitch)){
          // valid stitch
          if(this.data.timeline[t].isSuspended(stitch)){
            // suspended
            ctx.beginPath();
            ctx.moveTo(x + 1, y);
            ctx.arc(x, y, 1, 0, Math.PI);
            ctx.arc(x, y, 1, Math.PI, Math.PI * 2);
            ctx.closePath();
            ctx.lineWidth = 1;
            ctx.strokeStyle = s ? '#eee' : '#ccc';
            ctx.stroke();
          } else {
            // color
            let color = patternColor(stitch.pattern, s);
            let r = showInstr ? 3 : 2;
            // active stitch
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI);
            ctx.arc(x, y, r, Math.PI, Math.PI * 2);
            // ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.closePath();
            if(showInstr)
              ctx.fillStyle = s ? '#ccc' : '#fff';
            else
              ctx.fillStyle = color;
            ctx.fill();

            // instruction
            if(showInstr && stitch.pattern <= instrImages.length){
              ctx.lineWidth = 1;
              ctx.strokeStyle = color;
              ctx.stroke();
              // note: do not show image in back side layer
              if(!s){
                ctx.save();
                ctx.clip();
                ctx.drawImage(instrImages[stitch.pattern - 1], x - r, y - r, r * 2, r * 2);
                ctx.restore();
              }
            }
          } // endelse
        } // endif stitch && !array
      } // endfor x
    } // endfor t
  } // endfor s
};

Layout.prototype.drawPostText = function(zoom){
  let ctx = this.context;
  ctx.font = '16px Arial';
  ctx.fillStyle = '#000';
  // - zoom
  ctx.fillText('Zoom: ' + Math.round(zoom * 100), 10, this.height - 48);
  // - offset x / y
  // - frame time?
  // - filename
  // - number of stitches / nodes / links
  // - layout size (width and length)
  ctx.fillText('Width: ' + (this.data.width || 0), 10, this.height - 32);
  ctx.fillText('Length: ' + (this.data.length || 0), 10, this.height - 16);
};

Layout.prototype.drawPreText = function(){
  // error+warning messages
  let ctx = this.context;
  ctx.font = '16px Arial';
  // warnings
  let _y = 20;
  let y = () => {
    let curr = _y;
    _y += 16;
    return curr;
  };
  const counts = (str, arr) => {
    return arr.length > 1 ? str + 's' : str;
  };

  // visual state
  let hasErrors = false;

  // assertion errors
  if(this.assertErrors.length){
    hasErrors = true;
    ctx.fillStyle = '#a39';
    ctx.fillText(this.assertErrors.length + ' ' + counts('issue', this.assertErrors) + ':', 10, y());
    for(let i = 0; i < 5 && i < this.assertErrors.length; ++i){
      let message = this.assertErrors[i].args.join(' ');
      if(message.length > 50)
        message = message.slice(0, 49) + '...';
      ctx.fillText(message, 10, y());
    }
  }

  // warnings
  if(this.data.warnings.length){
    hasErrors = true;
    ctx.fillStyle = '#960';
    ctx.fillText(this.data.warnings.length + counts(' warning', this.data.warnings) + ':', 10, y());
    for(let i = 0; i < 5 && i < this.data.warnings.length; ++i){
      ctx.fillText(this.data.warnings[i].message, 10, y());
    }
  }
  // errors
  if(this.data.errors.length){
    hasErrors = true;
    ctx.fillStyle = '#900';
    ctx.fillText(this.data.errors.length + ' ' + counts('errors', this.data.errors) + ':', 10, y());
    for(let i = 0; i < 5 && i < this.data.errors.length; ++i){
      let err = this.data.errors[i];
      ctx.fillText(err.message + ' at t=' + err.time + ', idx=' + err.index + ', s=' + err.side, 10, y());
    }
  }
  // perfect state
  if(!hasErrors){
    ctx.fillStyle = '#090';
    ctx.fillText('No error', 10, y());
  }
};

// ###########################################################################
// ##### Extensions ##########################################################
// ###########################################################################

Object.assign(Layout.prototype, require('./output-layout-actions')); // mouse interactions
Object.assign(Layout.prototype, require('./output-layout-draw')); // drawing interactions
Object.assign(Layout.prototype, require('./output-layout-menu')); // context menu

// ###########################################################################
// ##### Exports #############################################################
// ###########################################################################

function drawLayout(tnb, reset){
  let output = document.getElementById('output-layout');
  if(!layout){
    layout = new Layout(output);
    // initial zoom stuff
    setTimeout(() => {
      layout.centerLayout();
    }, 500);
  }
  layout.updateData(tnb, reset);
}

module.exports = drawLayout;
