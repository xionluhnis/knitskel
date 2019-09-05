// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const { FRONT_SIDE, SIDE_FROM_STR } = require('../bed.js');
const ContextMenu = require('./contextmenu.js');
const sk = require('../skeleton.js');
const env = require('../env.js');

function renderSkeleton(...args){
  require('./skeleton.js').renderSkeleton(...args);
}

const spaceX = 10;

const ActionMode = {
  SELECT:   0,
  // sizing
  LENGTH:   1,
  WIDTH:    2,
  WIDTH2:   3,
  WIDTH3:   4,
  // layout
  LAYOUT_AUTO:    5,
  LAYOUT_MANUAL:  6,
  ALIGN_LEFT:     7,
  ALIGN_CENTER:   8,
  ALIGN_RIGHT:    9,
  // seams
  SEAM_CENTER:    10,
  SEAM_SIDES:     11,
  DRAW_SEAMS:     12,
  // patterns
  DRAW_PATTERN:   13
};

const CLICK_ACTIONS = {
  [ActionMode.LAYOUT_AUTO]:   true,
  [ActionMode.ALIGN_LEFT]:    true,
  [ActionMode.ALIGN_CENTER]:  true,
  [ActionMode.ALIGN_RIGHT]:   true,
  [ActionMode.SEAM_CENTER]:   true,
  [ActionMode.SEAM_SIDES]:    true
};

const SheetOrJoint = [ sk.NODE_SHEET, sk.NODE_JOINT ];
const JointOrSplit = [ sk.NODE_JOINT, sk.NODE_SPLIT ];

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

module.exports = {
  startInteraction(container) {
    // interaction data
    this.clicking = this.dragging = false;
    this.selection = [];
    this.selectionMap = {};
    this.highlight = [];
    this.highlightMap = {};
    // x / y
    this.mouseX = this.mouseY = 0;
    this.lastMouseX = this.lastMouseY = 0;
    this.clientX = this.clientY = 0;
    // index / time
    this.mouseIndex = this.mouseTime = 0;
    this.targetIndex = this.targetTime = 0;
    this.lastTargetIndex = this.lastTargetTime = 0;

    // create contextmenu
    this.menu = new ContextMenu([ { text: 'Skeleton Layout' } ]);
    this.canvas.addEventListener('contextmenu', () => {
      this.menu.reload(this.getMenu());
      this.tooltip(); // hide tooltip
      this.menu.show(event);
    });

    // create interactions
    this.canvas.addEventListener('mousemove', event => {
      // raw mouse
      this.lastMouseX = this.mouseX;
      this.lastMouseY = this.mouseY;
      this.mouseX = event.offsetX;
      this.mouseY = event.offsetY;
      this.clientX = event.clientX;
      this.clientY = event.clientY;
      // layout location
      this.lastTargetIndex = this.targetIndex;
      this.lastTargetTime  = this.targetTime;
      let { mouseIndex, mouseTime } = this.getMouseIndexAndTime(this.mouseX, this.mouseY);
      this.mouseIndex  = mouseIndex;
      this.mouseLeft   = this.invertX ? this.data.width - 1 - mouseIndex : mouseIndex; // non-inverted left location
      this.mouseTime   = mouseTime;
      this.targetIndex = Math.round(mouseIndex);
      this.targetTime  = Math.round(mouseTime);
      // interaction state
      this.dragging = this.clicking;
      // update visual highlight
      let updated = this.updateHighlight();
      // action update
      if(!this.moveMode && this.actionMode != ActionMode.SELECT)
        this.actionMove(updated);
      // debug
      // console.log('mouse at ' + this.mouseX + '/' + this.mouseY + ' => t=' + this.targetTime + ', x=' + this.targetIndex);
    });
    this.canvas.addEventListener('mouseout', (/*event*/) => {
      this.clicking = this.dragging = false;
      this.tooltip();
    });
    this.canvas.addEventListener('click', event => {
      if(this.actionMode == ActionMode.SELECT)
        this.updateSelection(event);
    });
    this.canvas.addEventListener('pointerdown', event => {
      this.clicking = event.button === 0;
      // left click = action
      if(this.clicking){
        if(this.moveMode){
          this.canvas.style.cursor = 'grabbing';
        } else if(this.actionMode != ActionMode.SELECT){
          this.actionStart(event);
        }
      }
    });
    // /!\ mouseup does not trigger on Chrome with Shift
    this.canvas.addEventListener('pointerup', event => {
      // state out
      this.clicking = this.dragging = false;
      if(this.moveMode)
        this.canvas.style.cursor = 'grab';
      else if(this.actionMode != ActionMode.SELECT)
        this.actionStop(event);
    });

    // tooltip
    this.tooltipContainer = createElement('div', ['tooltip', 'hidden']);
    container.appendChild(this.tooltipContainer);

    // toolbar modes
    this.actionMode = ActionMode.SELECT;
    this.actionTarget = null;
    for(let input of document.querySelectorAll('#shape-select, .for-shape input[type=radio], #draw-pattern')){
      let inputAction = ActionMode[input.id.replace('shape-', '').replace(/-/g, '_').toUpperCase()];
      input.addEventListener('change', () => {
        this.actionMode = inputAction;
        this.updateInteraction();
        this.updateActions();
      });
    }
    this.updateActions();

    // draw UI
    this.initDrawUI();

    // drag mode for non-select action
    // note: canvas doesn't get keydown unless it has tabindex
    this.moveMode = false;
    window.addEventListener('keydown', event => {
      // shift => allow paning if in not select mode
      if(this.moveMode)
        return true;
      if(this.actionMode != ActionMode.SELECT && event.keyCode == 16){
        this.enablePaning();
        this.moveMode = true;
        this.canvas.style.cursor = 'grab';
        return true;
      }
    });
    window.addEventListener('keyup', event => {
      if(this.actionMode != ActionMode.SELECT && event.keyCode == 16){
        this.moveMode = false;
        this.canvas.style.cursor = '';
        this.disablePaning();
      }
    });
  },

  updateInteraction(){
    if(this.actionMode == ActionMode.SELECT)
      this.enablePaning();
    else {
      this.disablePaning();
      this.updateSelection();
    }
  },

  shouldShowInterfaces(shape){
    if(this.actionMode == ActionMode.SELECT)
      return true;
    if(this.actionMode == ActionMode.LENGTH
    && [sk.SHEET, sk.JOINT].includes(shape.node.category))
      return true;
    return false;
  },

  actionStart(/* event */){
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    const grpTargets = this.data.at(this.targetTime).groupsAt(this.targetIndex, firstSide);
    this.actionTarget = null; // empty by default
    if(grpTargets.length !== 1){
      return;
    }
    const grp = grpTargets[0];
    const gid = grp.parent.id;
    const { shape, groups } = this.data.groupMap[gid];
    switch(this.actionMode){
      case ActionMode.LENGTH: {
        // only for sheet (length) or joint (rows)
        if(!SheetOrJoint.includes(shape.node.category))
          return;
        let zeroIdx = groups[0] == grp ? groups.length - 1 : 0;
        let zeroTime = groups[zeroIdx].time;
        let srcTime = groups[groups.length - 1 - zeroIdx].time;
        this.actionTarget = { shape, srcTime, zeroTime, groups };
        this.canvas.style.cursor = 'ns-resize';
      } break;

      case ActionMode.WIDTH:
      case ActionMode.WIDTH2:
      case ActionMode.WIDTH3: {
        // only for sheet (width) or joint (width)
        if(!SheetOrJoint.includes(shape.node.category))
          return;
        // only if we have enough rows to have the length split
        // in that many interpolation points (1, 2 or 3)
        let currLen = shape.node.length || shape.node.rows || 0;
        if(currLen < this.actionMode - ActionMode.WIDTH + 1)
          return;
        let srcTime = this.targetTime;
        this.actionTarget = { shape, groups, srcTime };
        this.canvas.style.cursor = 'ew-resize';
      } break;

      case ActionMode.LAYOUT_AUTO:
        if(JointOrSplit.includes(shape.node.category)){
          // directly apply auto mode
          shape.node.layout = sk.LAYOUT_AUTO;
          if(shape.node.category == sk.NODE_SPLIT){
            shape.node.alignment = sk.ALIGN_UNIFORM;
          }
          renderSkeleton(true);
        }
        break;

      case ActionMode.LAYOUT_MANUAL: {
        let cat = shape.node.category;
        // only for joint (layout) or split (layout)
        if(!JointOrSplit.includes(cat))
          return;
        let twosided = (cat == sk.NODE_SPLIT && shape.isTwoSided('base'))
                    || (cat == sk.NODE_JOINT && shape.isTwoSided(0));
        let folded = !!shape.node.folded;
        let values = shape.node.layout.values();
        // compute actual layout index => will be modifying that one
        let layoutIndex = 0;
        if(cat == sk.NODE_SPLIT && shape.node.degree > 1){
          // find corresponding initial "value" in [0;1)
          // using targetIndex + side + twosided/folded-ness
          let value = this.getRelativeIndex(groups, twosided && !folded);
          layoutIndex = shape.node.layout.indexOf(value);
        } // else layoutIndex = 0
        this.actionTarget = {
          shape, groups, index: layoutIndex,
          twosided, folded, values
        };
        this.canvas.style.cursor = 'ew-resize';
      } break;

      case ActionMode.ALIGN_LEFT:
      case ActionMode.ALIGN_CENTER:
      case ActionMode.ALIGN_RIGHT: {
        let isSplit = shape.node.category == sk.NODE_SPLIT;
        if('alignment' in shape.node){
          let alignment;
          if(this.actionMode == ActionMode.ALIGN_LEFT)
            alignment = sk.ALIGN_LEFT;
          else if(this.actionMode == ActionMode.ALIGN_RIGHT)
            alignment = sk.ALIGN_RIGHT;
          else {
            assert(this.actionMode == ActionMode.ALIGN_CENTER, 'Invalid alignment action', this.actionMode);
            alignment = isSplit ? sk.ALIGN_UNIFORM : sk.ALIGN_CENTER;
          }
          shape.node.alignment = alignment;
          if(isSplit)
            shape.node.layout = sk.LAYOUT_AUTO;
          renderSkeleton(true);
        }
      } break;

      case ActionMode.SEAM_CENTER:
      case ActionMode.SEAM_SIDES:
        // only for sheet
        if(shape.node.category == sk.NODE_SHEET){
          shape.node.shaper = this.actionMode == ActionMode.SEAM_CENTER ? 'center' : 'uniform';
          renderSkeleton(true);
        }
        break;

      case ActionMode.DRAW_PATTERN: {
        this.actionTarget = {
          shape, groups, changes: new Set(),
          srcTime: this.targetTime, srcIndex: this.targetIndex
        };
        this.drawStart(shape);
      } break;
    }
  },

  updateActions(){
    this.canvas.style.cursor = 'default';
    if(this.drawTarget){
      // check it's still valid
      if(!env.isNodeValid(this.drawTarget.node.id)){
        this.drawTarget = null; // remove as not valid anymore (e.g. deleted node)
      } else {
        // update to last shape version
        const { shape } = this.data.nodeMap[this.drawTarget.node.id];
        assert(shape, 'No corresponding shape for a still valid node');
        this.drawTarget = shape;
      }
    }
    this.updateDrawUI(this.drawTarget);
  },

  actionMove(updated){
    // skip if already drawn through updateHighlight
    if(updated || this.highlight.length)
      return;
    // skip if without action target and not drawing
    const drawing = this.actionMode != ActionMode.DRAW_PATTERN;
    if(!this.actionTarget && !drawing)
      return;
    switch(this.actionMode){

      case ActionMode.LENGTH:
      case ActionMode.WIDTH:
      case ActionMode.WIDTH2:
      case ActionMode.WIDTH3:
      case ActionMode.LAYOUT_MANUAL:
      case ActionMode.DRAW_SCALE:
      case ActionMode.DRAW_TILE:
      case ActionMode.DRAW_SINGLE:
        this.drawHighlight();
        break;
    }
  },

  actionStop(/* event */){
    let actionTarget = this.actionTarget;
    if(!actionTarget)
      return;
    // clear action target
    this.actionTarget = null;
    this.canvas.style.cursor = ''; // reset cursor
    switch(this.actionMode){
      case ActionMode.LENGTH: {
        let { shape, srcTime, zeroTime } = actionTarget;
        let newLength = Math.abs(this.targetTime - zeroTime);
        let propName = shape.node.category == sk.NODE_SHEET ? 'length' : 'rows';
        // /!\ some rows don't contribute to length!
        // => measure the change in length instead
        let lenDelta = newLength - Math.abs(srcTime - zeroTime);
        if(lenDelta){
          let newValue = Math.max(1, shape.node[propName] + lenDelta);
          shape.node[propName] = newValue;
          renderSkeleton(true);
        }
      } break;

      case ActionMode.WIDTH: {
        let { shape, groups } = actionTarget;
        let [left, right] = this.getWidthLeftRight(shape, groups);
        let newWidth = Math.round((right - left + 1) / shape.getNeedleScale());
        if(newWidth <= 2)
          return;
        if(shape.node.width.isConstant() && newWidth == shape.node.width.data)
          return;
        // update the width to that constant
        shape.node.width = newWidth;
        renderSkeleton(true);
      } break;

      case ActionMode.WIDTH2: {
        let { shape, groups, srcTime } = actionTarget;
        let botTime = groups[0].time;
        let topTime = groups[groups.length - 1].time;
        let grpIndex = 0;
        if(Math.abs(botTime - srcTime) > Math.abs(topTime - srcTime))
          grpIndex = groups.length - 1;
        let [left, right] = this.getWidthLeftRight(shape, [groups[grpIndex]]);
        let newWidth = Math.round((right - left + 1) / shape.getNeedleScale());
        if(newWidth < 2)
          return;
        // update the width to the binary function
        let botWidth = shape.node.width.first();
        let topWidth = shape.node.width.last();
        // enforce bot/top direction for screen
        if(groups[groups.length - 1].crsId == 0)
          [botWidth, topWidth] = [topWidth, botWidth];
        // set new width
        if(grpIndex)
          topWidth = newWidth;
        else
          botWidth = newWidth;
        // reset direction to skeleton semantics
        if(groups[groups.length - 1].crsId == 0)
          [botWidth, topWidth] = [topWidth, botWidth];
        shape.node.width = [0, botWidth, 1, topWidth];
        renderSkeleton(true);
      } break;

      case ActionMode.WIDTH3: {
        let { shape, groups } = actionTarget;
        let botTime = groups[0].time;
        let topTime = groups[groups.length - 1].time;
        let midTime = Math.max(botTime + 1, Math.min(topTime - 1, this.targetTime));
        let [left, right] = this.getWidthLeftRight(shape, groups);
        let newWidth = Math.round((right - left + 1) / shape.getNeedleScale());
        if(newWidth < 2)
          return;
        // update the width to the 3-value function
        let botWidth = shape.node.width.first();
        let topWidth = shape.node.width.last();
        let mid = (midTime - botTime) / (topTime - botTime);
        // change index to account for direction
        if(groups[groups.length - 1].crsId == 0){
          mid = 1 - mid;
        }
        // console.log(0, botWidth, mid, newWidth, 1, topWidth);
        shape.node.width = [0, botWidth, mid, newWidth, 1, topWidth];
        renderSkeleton(true);
      } break;

      case ActionMode.LAYOUT_MANUAL: {
        let { shape, values, groups, folded, twosided, index } = actionTarget;
        let x = this.getRelativeIndex(groups, twosided && !folded);
        // update the layout
        let newLayout = values.map((val, idx) => {
          return idx == index ? x : val;
        });
        shape.node.layout = newLayout;
        // splits require manual alignment
        if(shape.node.category == sk.NODE_SPLIT){
          shape.node.alignment = sk.ALIGN_MANUAL;
        }
        renderSkeleton(true);
      } break;

      case ActionMode.DRAW_PATTERN: {
        this.drawStop(actionTarget);
      } break;
    }
  },

  drawHighlightText(ctx, text, x, y){
    const textWidth = ctx.measureText(text).width;
    const textHeight = 9;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(x, y - textHeight, textWidth, textHeight + 2);
    ctx.fillStyle = '#000';
    ctx.fillText(text, x, y);
  },

  drawAction(){
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    const ctx = this.frontContext;

    // click actions
    if(this.actionMode in CLICK_ACTIONS){
      const grpTargets = this.data.at(this.targetTime).groupsAt(this.targetIndex, firstSide);
      if(grpTargets.length != 1)
        return;
      const groups = this.data.groupMap[grpTargets[0].parent.id].groups;
      let ext0 = this.getRowExtents(groups[0]);
      let ext1 = this.getRowExtents(groups[groups.length - 1]);
      ctx.beginPath();
      ctx.strokeStyle = '#000';
      ctx.moveTo(ext1.left,  ext1.top);
      ctx.lineTo(ext0.left,  ext0.bottom);
      ctx.lineTo(ext0.right, ext0.bottom);
      ctx.lineTo(ext1.right, ext1.top);
      ctx.closePath();
      ctx.stroke();
      return;
    }

    if(this.actionMode == ActionMode.DRAW_PATTERN){
      this.drawPattern();
      return;
    }

    if(!this.actionTarget)
      return;

    // dragging action previews
    switch(this.actionMode){
      case ActionMode.LENGTH: {
        let { groups, zeroTime } = this.actionTarget;
        // highlight both start and end rows
        let zerIdx = zeroTime == groups[0].time ? 0 : groups.length - 1;
        let srcIdx = groups.length - 1 - zerIdx;
        let ext0 = this.drawRowHighlight(ctx, groups[zerIdx], 'rgba(0, 0, 0, 0.5)');
        let ext1 = this.drawRowHighlight(ctx, groups[srcIdx], 'rgba(0, 0, 0, 0.5)', this.targetTime);
        ctx.beginPath();
        ctx.strokeStyle = '#000';
        ctx.moveTo(ext0.left,  (ext0.top + ext0.bottom) * 0.5);
        ctx.lineTo(ext1.left,  (ext1.top + ext1.bottom) * 0.5);
        ctx.moveTo(ext0.right, (ext0.top + ext0.bottom) * 0.5);
        ctx.lineTo(ext1.right, (ext1.top + ext1.bottom) * 0.5);
        ctx.stroke();
        // width information
        let info = 'Length: ' + (Math.abs(zeroTime - this.targetTime) + 1);
        this.drawHighlightText(ctx, info, (srcIdx > zerIdx ? ext0.left : ext1.left), Math.min(ext0.bottom, ext1.bottom) + 10);
      } break;

      case ActionMode.WIDTH: {
        let { shape, groups } = this.actionTarget;
        let ext0 = this.getRowExtents(groups[0]);
        let ext1 = this.getRowExtents(groups[groups.length - 1]);
        let [left, right] = this.getWidthLeftRight(shape, groups, true);
        ctx.beginPath();
        ctx.strokeStyle = '#000';
        ctx.moveTo(left,  ext1.top);
        ctx.lineTo(left,  ext0.bottom);
        ctx.lineTo(right, ext0.bottom);
        ctx.lineTo(right, ext1.top);
        ctx.closePath();
        ctx.stroke();
        // width information
        let info = 'Width: ' + Math.round(right / spaceX - left / spaceX + 1);
        this.drawHighlightText(ctx, info, left, ext1.top + 10);
      } break;

      case ActionMode.WIDTH2: {
        let { shape, groups, srcTime } = this.actionTarget;
        let ext0 = this.getRowExtents(groups[0]);
        let ext1 = this.getRowExtents(groups[groups.length - 1]);
        let botTime = groups[0].time;
        let topTime = groups[groups.length - 1].time;
        let grpIndex = 0;
        if(Math.abs(botTime - srcTime) > Math.abs(topTime - srcTime))
          grpIndex = groups.length - 1;
        let [left, right] = this.getWidthLeftRight(shape, [groups[grpIndex]], true);
        ctx.beginPath();
        ctx.strokeStyle = '#000';
        ctx.moveTo(grpIndex ? left : ext1.left,  ext1.top);
        ctx.lineTo(grpIndex ? ext0.left : left,  ext0.bottom);
        ctx.lineTo(grpIndex ? ext0.right : right, ext0.bottom);
        ctx.lineTo(grpIndex ? right : ext1.right, ext1.top);
        ctx.closePath();
        ctx.stroke();
        // width information
        let info = 'Width: ' + Math.round(right / spaceX - left / spaceX + 1);
        this.drawHighlightText(ctx, info, left, grpIndex ? ext1.top + 10 : ext0.top + 7);
      } break;

      case ActionMode.WIDTH3: {
        let { shape, groups } = this.actionTarget;
        let ext0 = this.getRowExtents(groups[0]);
        let ext1 = this.getRowExtents(groups[groups.length - 1]);
        let botTime = groups[0].time;
        let topTime = groups[groups.length - 1].time;
        let midTime = Math.max(botTime + 1, Math.min(topTime - 1, this.targetTime));
        // let grpIndex = Math.round(botTime - midTime);
        let [left, right] = this.getWidthLeftRight(shape, groups, true);
        let middle = this.getY(midTime, 0);
        ctx.beginPath();
        ctx.strokeStyle = '#000';
        ctx.moveTo(ext1.left,  ext1.top);
        ctx.lineTo(left, middle);
        ctx.lineTo(ext0.left,  ext0.bottom);
        ctx.lineTo(ext0.right, ext0.bottom);
        ctx.lineTo(right, middle);
        ctx.lineTo(ext1.right, ext1.top);
        ctx.closePath();
        ctx.stroke();
        // width information
        let info = 'Width: ' + Math.round(right / spaceX - left / spaceX + 1);
        this.drawHighlightText(ctx, info, left, middle);
      } break;

      case ActionMode.LAYOUT_MANUAL: {
        // - line in center of node
        // - corresponding tick values
        // -> fixed black for non-modified value
        // -> gray for initial value of modified one
        // -> blue for new value of modified one
        // -> twosided non-folded => bottom = [0;0.5), top = [0.5;1)
        // -> onesided or folded  => across = [0;1)
        let { values, index, groups, folded, twosided } = this.actionTarget;
        let ext0 = this.getRowExtents(groups[0]);
        let ext1 = this.getRowExtents(groups[groups.length - 1]);
        let botTime = groups[0].time;
        let topTime = groups[groups.length - 1].time;

        // mode of values
        let halfed = false;
        let reversed = false;
        if(twosided && !folded){
          halfed = true;
          reversed = firstSide != FRONT_SIDE;
        }

        // draw
        let midY = (ext0.bottom + ext1.top) * 0.5;
        let left = (ext0.left + ext1.left) * 0.5;
        let right = (ext0.right + ext1.right) * 0.5;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillRect(left, midY - 10, right - left, 20);
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.moveTo(left, midY);
        ctx.lineTo(right, midY);
        if(halfed){
          ctx.moveTo((left + right) * 0.5, midY);
          ctx.arc((left + right) * 0.5, midY, (right - left) * 0.5, 0, Math.PI * 2);
        }
        ctx.stroke();
        // original values
        for(let idx = 0; idx < values.length; ++idx){
          let val = values[idx];
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.strokeStyle = idx == index ? '#69f' : '#666';
          if(halfed){
            let upper = val > 0.5;
            if(upper)
              val = 1 - val; // [0.5;1) -> [0;0.5)
            // else [0;0.5)
            let x = left + (right - left) * val * 2;
            ctx.moveTo(x, midY);
            ctx.lineTo(x, upper ? midY - 15 : midY + 15);
          } else {
            let x = left + (right - left) * val;
            ctx.moveTo(x, midY - 10);
            ctx.lineTo(x, midY + 10);
          }
          ctx.stroke();
        }
        // current value
        ctx.beginPath();
        ctx.strokeStyle = '#39f';
        ctx.lineWidth = 3;
        let x = Math.max(left, Math.min(right, this.mouseIndex * spaceX));
        if(halfed){
          let upper = this.targetTime > (topTime + botTime) * 0.5;
          ctx.moveTo(x, midY);
          ctx.lineTo(x, upper ? midY - 25 : midY + 25);
          // on circle
          let r = (right - left) * 0.5;
          let dx = x - (right + left) * 0.5;
          let dy = Math.sqrt(r * r - dx * dx);
          let y = upper ? midY - dy : midY + dy;
          ctx.moveTo(x, y);
          ctx.arc(x, y, 5, 0, Math.PI * 2);
        } else {
          ctx.moveTo(x, midY - 15);
          ctx.lineTo(x, midY + 15);
        }
        ctx.stroke();
        ctx.lineWidth = 1;

      } break;
    }

  },

  getRelativeIndex(groups, halfed){
    let ext0 = this.getRowExtents(groups[0]);
    let ext1 = this.getRowExtents(groups[groups.length - 1]);
    let botTime = groups[0].time;
    let topTime = groups[groups.length - 1].time;

    // new layout value
    let left = (ext0.left + ext1.left) * 0.5;
    let right = (ext0.right + ext1.right) * 0.5;
    let x = Math.max(0, Math.min(1, (this.mouseIndex * spaceX - left) / (right - left)));
    if(halfed){
      // XXX take side into account?
      if(this.targetTime > (topTime + botTime) * 0.5){
        // top is inversed: left should be 1, right should 0.5
        x = 1 - x * 0.5; // [0;1) -> [1;2) -> [0.5;1)
      } else {
        // bottom is normal: left should be 0, right should 0.5
        x = x * 0.5; // [0;1) -> [0;0.5)
      }
    }
    return x;
  },

  getWidthLeftRight(shape, groups, inSpace){
    let ext0 = this.getRowExtents(groups[0]);
    let ext1 = this.getRowExtents(groups[groups.length - 1]);
    let left, right;
    if(shape.node.alignment == sk.ALIGN_LEFT){
      left = Math.min(ext0.left, ext1.left);
      right = this.targetIndex * spaceX;
      if(right < left)
        [left, right] = [right, left];
    } else if(shape.node.alignment == sk.ALIGN_RIGHT){
      right = Math.max(ext0.right, ext1.right);
      left = this.targetIndex * spaceX;
      if(right < left)
        [left, right] = [right, left];
    } else {
      assert(shape.node.alignment == sk.ALIGN_CENTER, 'Invalid alignment ', shape.node.alignment);
      let middle = (ext0.left + ext1.left + ext0.right + ext1.right) / 4;
      let delta = Math.abs(middle - this.mouseIndex * spaceX);
      left = Math.floor(middle - delta);
      right = Math.floor(middle + delta);
    }
    if(!inSpace){
      left /= spaceX;
      right /= spaceX;
    }
    return [left, right];
  }

};
