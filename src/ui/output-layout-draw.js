// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const { SIDE_FROM_STR, FRONT_SIDE } = require('../bed.js');
const UserPattern = require('../userpattern.js');
const { patternColor } = require('./colors.js');
const { editPattern } = require('./pattern.js');

function renderSkeleton(...args){
  require('./skeleton.js').renderSkeleton(...args);
}

function loadImage(...args){
  return require('../pattern.js').loadImage(...args);
}

const LayerTypeName = {
  [UserPattern.PROGRAM]: 'Pr',
  [UserPattern.SINGULAR]: 'Dr',
  [UserPattern.SCALABLE]: 'Sc',
  [UserPattern.TILEABLE]: 'Ti'
};
const LayerTypeDesc = {
  [UserPattern.PROGRAM]: 'User program',
  [UserPattern.SINGULAR]: 'Basic non-spreading drawing',
  [UserPattern.SCALABLE]: 'Drawing that scales with size',
  [UserPattern.TILEABLE]: 'Drawing that tiles with size'
};

const Tool = {
  CLEAR: 0,
  MOVE: -1,
  RESIZE: -2
};

const DrawMode = 13;

const spaceX = 10;
const spaceY = 20;

function squareOf(x){
  return x * x;
}

function createElement(tag, clazz, text){
  let el = document.createElement(tag);
  if(Array.isArray(clazz)){
    for(let c of clazz)
      el.classList.add(c);
  } else
    el.className = clazz || '';
  if(text !== undefined)
    el.textContent = text;
  return el;
}

function createOption(value, text){
  let option = createElement('option');
  option.value = value;
  option.textContent = text || value;
  return option;
}

// @see https://stackoverflow.com/questions/808826/draw-arrow-on-canvas-tag
function drawArrow(ctx, fromx, fromy, tox, toy, move, headlen){
  if(!headlen)
    headlen = 10;
  let angle = Math.atan2(toy-fromy,tox-fromx);
  ctx.moveTo(fromx, fromy);
  ctx.lineTo(tox, toy);
  if(move)
    ctx.moveTo(tox, toy);
  ctx.lineTo(tox-headlen*Math.cos(angle-Math.PI/6),toy-headlen*Math.sin(angle-Math.PI/6));
  ctx.moveTo(tox, toy);
  ctx.lineTo(tox-headlen*Math.cos(angle+Math.PI/6),toy-headlen*Math.sin(angle+Math.PI/6));
}

module.exports = {

  initDrawUI() {
    // pattern tool / instructions
    this.drawTarget = null;
    this.drawLayer  = 0;
    this.instr = 0;
    for(let input of document.querySelectorAll('#pattern-instr .instr input[type=radio]')){
      input.addEventListener('change', () => {
        this.updateTool(input);
      });
    }
    this.updateTool();

    // layer actions
    document.getElementById('layer-add').addEventListener('click', () => {
      if(this.drawTarget){
        this.drawTarget.node.pattern.createLayer();
        this.drawLayer = this.drawTarget.node.pattern.layers.length - 1;
        this.updateDrawUI(); // no topology change
      }
    });
    document.getElementById('layer-remove').addEventListener('click', () => {
      if(this.drawTarget){
        this.drawTarget.node.pattern.removeLayer(this.drawLayer || 0);
        // this.updateDrawUI();
        renderSkeleton(true);
      }
    });
    document.getElementById('layer-up').addEventListener('click', () => {
      if(this.drawTarget){
        this.drawTarget.node.pattern.moveLayerDown(this.drawLayer);
        this.drawLayer = Math.max(0, this.drawLayer - 1);
        // this.updateDrawUI();
        renderSkeleton(true);
      }
    });
    document.getElementById('layer-down').addEventListener('click', () => {
      if(this.drawTarget){
        this.drawTarget.node.pattern.moveLayerUp(this.drawLayer);
        this.drawLayer = Math.min(this.drawLayer + 1, this.drawTarget.node.pattern.layers.length - 1);
        // this.updateDrawUI();
        renderSkeleton(true);
      }
    });
    document.getElementById('layer-copy').addEventListener('click', () => {
      if(this.drawTarget){
        this.drawTarget.node.pattern.duplicateLayer(this.drawLayer);
        this.drawLayer = this.drawTarget.node.pattern.layers.length - 1;
        // this.updateDrawUI();
        renderSkeleton(true);
      }
    });
    document.getElementById('layer-side').addEventListener('click', () => {
      if(this.drawTarget && this.drawTarget.sided){
        this.drawTarget.node.pattern.switchSides(this.drawLayer);
        renderSkeleton(true);
      }
    });
    const layerType = document.getElementById('layer-type');
    layerType.addEventListener('change', () => {
      this.changeLayerType(parseInt(layerType.value));
    });
    // save / load
    const file = document.getElementById('layer-file');
    const save = document.getElementById('layer-save');
    save.addEventListener('click', event => {
      if(!this.drawTarget){
        event.preventDefault();
        return false;
      }
      const pattern = this.drawTarget.node.pattern;
      const layer = pattern.layers[this.drawLayer];
      if(!layer){
        event.preventDefault();
        return false;
      }
      let str = JSON.stringify(layer.toJSON());
      let blob = new Blob([str], {type: "octet/stream"});
      let url = URL.createObjectURL(blob);
      save.href = url;
      save.download = (layer.name || 'pattern') + '.pat';
      // revoke url after click
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    });
    const load = document.getElementById('layer-load');
    load.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if(file.files.length){
        this.loadPatternFile(file.files[0]);
      }
      file.value = ''; // so we can load multiple times the same pattern in a row
    });

    // load pattern from server
    const use = document.getElementById('layer-use');
    fetch('skeletons/patterns/list.json')
      .then(res => res.json())
      .then(json => {
      assert(Array.isArray(json), 'Invalid list');
      for(let { path } of json){
        use.appendChild(createOption(path));
      }
      use.onchange = () => {
        if(use.value.length == 0)
          return;
        let path = use.value;
        this.loadPatternURL(path);
      };
    });
  },

  updateInstrSet(layerType){
    const group = document.getElementById('pattern-instr');
    const sides = document.getElementById('layer-side');
    if(layerType == UserPattern.PROGRAM){
      group.classList.add('disabled');
      sides.classList.add('disabled');
      return;
    } else {
      group.classList.remove('disabled');
      // switch side action
      if(this.drawTarget && this.drawTarget.sided)
        sides.classList.remove('disabled');
      else
        sides.classList.add('disabled');
    }
    for(let input of document.querySelectorAll('#pattern-instr .bottom .instr input')){
      let instr = input.id.replace('instr-', '');
      let disabled = false;
      if(layerType == UserPattern.SCALABLE)
        disabled = instr != 'move' && instr != 'resize' && parseInt(instr) > 4;
      else if(layerType == UserPattern.SINGULAR)
        disabled = instr == 'resize';
      input.disabled = disabled;
      if(disabled)
        input.parentNode.classList.add('disabled');
      else
        input.parentNode.classList.remove('disabled');
    }
    // reset instruction to scalable
    let active = document.querySelector('#pattern-instr .instr.active');
    if(active){
      let activeInput = active.getElementsByTagName('input')[0];
      if(activeInput.disabled)
        document.getElementById('instr-0').click();
    }
  },

  drawStart(shape){
    // /!\ note: cannot compare drawTarget directly
    // as it changes after each renderSkeleton
    if(!this.drawTarget || this.drawTarget.node.id != shape.node.id){
      this.drawTarget = shape;
      this.updateActions();
      this.actionTarget = null; // invalidate for now
    } else {
      // update to last version (with sidedness)
      this.drawTarget = shape;
      // get current layer
      const currLayer = this.currentPatternLayer();
      // for programs, we open the editor
      if(currLayer.type == UserPattern.PROGRAM){
        editPattern(shape.node.id, this.drawLayer);
        this.actionTarget = null; // invalidate for now
      } else {
        // starting the real action
        // => normalize current layer to use same layout as current shape
        const { groups } = this.actionTarget;
        // /!\ this should not change anything visually, but ensures
        // that the pattern has the same size for its abstract representation
        // => stretch / move behave as should be
        currLayer.updateFromGroup(groups[0].parent);
      }
    }
  },

  loadPatternData(layerData){
    // load JSON data as layer and add to pattern
    if(!UserPattern.isLayer(layerData))
      return;

    // should we invert side?
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    if(firstSide != FRONT_SIDE){
      if(layerData.data.length == 2){
        layerData.data.reverse();
      } else {
        layerData.data = [
          layerData.data[0].map(row => row.map(() => 0)), // artificial front pattern
          layerData.data[0]
        ];
      }
    }

    // create layer
    this.drawTarget.node.pattern.loadLayer(layerData);

    // update display
    renderSkeleton(true);
  },

  loadPatternURL(path){
    fetch('/skeletons/patterns/' + path)
      .then(res => res.json())
      .then(json => {
      this.loadPatternData(json);
    });
  },

  loadPatternFile(blob){
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    if(!this.drawTarget)
      return;
    const reader = new FileReader();
    if(blob.name.toLowerCase().endsWith('.pat')){
      // pat data
      reader.onload = event => {
        let layerData = JSON.parse(event.target.result);
        this.loadPatternData(layerData);
      };
      reader.readAsText(blob);
    } else {
      // image data
      reader.onload = event => {
        let url = event.target.result;
        let fname = blob.name.replace(/(.+)(\/|\\)/g, '');
        loadImage(url, fname, true).then(() => {
          let prog = '// pattern image\n';
          let side = firstSide != FRONT_SIDE ? 'back' : 'front';
          prog += 'pat.side("' + side + '").img("' + fname + '", 3, v => v > 100, true).purl();\n';
          this.loadPatternData({ type: UserPattern.PROGRAM, data: prog, name: fname });
        }).catch(() => {});
      };
      reader.readAsDataURL(blob);
    }
  },

  changeLayerType(newLayerType){
    if(!this.drawTarget)
      return;
    const layerIndex = this.drawLayer || 0;
    const currLayer = this.drawTarget.node.pattern.layers[layerIndex];
    if(!currLayer)
      return;
    if(currLayer.type == newLayerType)
      return; // nothing to do
    if(newLayerType == UserPattern.PROGRAM){
      currLayer.update(newLayerType, currLayer.toString());
    } else if(currLayer.type == UserPattern.PROGRAM){
      const node = this.drawTarget.node;
      const { groups } = this.data.nodeMap[node.id];
      assert(groups, 'Invalid draw target');
      currLayer.updateFromGroup(groups[0].parent, newLayerType);
    } else {
      let data = currLayer.data;
      if(newLayerType == UserPattern.SCALABLE){
        data = currLayer.data.map(side => side.map(row => row.map(instr => {
          return instr && instr > 4 ? 0 : instr; // reduce to scalable instructions
        })));
      } else
        data = currLayer.data;
      currLayer.update(newLayerType, data);
    }
    // this.updateDrawUI();
    this.updateInstrSet(newLayerType);
    renderSkeleton(true); // may have changed a lot
    /*
    if(currLayer.type == UserPattern.PROGRAM || newLayerType == UserPattern.PROGRAM){
      if(!confirm('Changing to/from a user program cannot be reversed. Are you sure?'))
        return;
    }
    */
  },

  updateDrawUI(){
    const layerGroup = document.getElementById('layer-group');
    const activeLayer = document.getElementById('active-layer');
    const layerType  = document.getElementById('layer-type');
    const patternGroup = document.getElementById('pattern-instr');
    if(!this.drawTarget || this.actionMode != DrawMode){
      layerGroup.classList.add('disabled');
      if(!this.drawTarget)
        activeLayer.textContent = 'Select node';
      layerType.disabled = true;
      patternGroup.classList.add('disabled');
      return;
    }
    patternGroup.classList.remove('disabled');

    // we have one active draw target
    const node = this.drawTarget.node;
    const up = node.pattern;
    const layers = up.layers;
    if(this.drawLayer < 0)
      this.drawLayer = 0;
    if(this.drawLayer >= layers.length)
      this.drawLayer = layers.length - 1;
    const layerIndex = this.drawLayer;
    const currLayer = layers[layerIndex];
    layerGroup.classList.remove('disabled');
    // set active layer
    const updateName = (newName) => {
      if(newName === undefined)
        newName = currLayer.name;
      else
        currLayer.name = newName;
      activeLayer.textContent = '#' + node.id + ' > ' + layerIndex + (newName ? ' - ' + newName : '');
    };
    updateName();
    // set current layer type
    layerType.disabled = false;
    layerType.value = currLayer.type;

    // update instruction set
    this.updateInstrSet(currLayer.type);

    // populate layer list
    const list = document.getElementById('pattern-layers');
    while(list.firstChild)
      list.removeChild(list.firstChild);
    for(let i = 0; i < layers.length; ++i){
      const item = createElement('li', 'layer');
      if(i == layerIndex)
        item.classList.add('active');
      // node
      item.appendChild(createElement('div', 'node', 'N' + node.id));
      // type
      const type = createElement('div', 'type', LayerTypeName[layers[i].type]);
      type.title = LayerTypeDesc[layers[i].type];
      item.appendChild(type);
      // name
      const name = createElement('div', 'name', layers[i].name);
      name.setAttribute('data-index', i);
      if(i == layerIndex){
        name.setAttribute('contenteditable', true);
        name.addEventListener('input', () => {
          updateName(name.textContent);
        });
      } else {
        item.addEventListener('click', () => {
          this.drawLayer = i;
          this.updateDrawUI();
          this.drawHighlight();
        });
      }
      item.appendChild(name);
      list.appendChild(item);
    }
  },

  updateTool(input){
    if(!input){
      input = document.querySelector('#instr-0'); // clear by default
    }
    const tool = input.id.replace('instr-', '');
    switch(tool){
      case 'move':    this.instr = -1; break;
      case 'resize':  this.instr = -2; break;
      default:        this.instr = parseInt(tool); break;
    }

    // set active tool class
    for(let inp of document.querySelectorAll('#pattern-instr input')){
      if(inp != input){
        inp.parentNode.classList.remove('active');
      }
    }
    input.parentNode.classList.add('active');

    // update active element
    const labelOf = inp => inp.parentNode.getElementsByTagName('label')[0];
    const activeInstr = document.getElementById('instr-active');
    labelOf(activeInstr).textContent = labelOf(input).textContent;
    const style = getComputedStyle(input);
    activeInstr.style.backgroundImage = style.backgroundImage.replace('white_', '');
    if(input.id == 'instr-move' || input.id == 'instr-0')
      activeInstr.style.backgroundColor = 'white';
    else
      activeInstr.style.backgroundColor = style.backgroundColor;
  },

  currentPatternLayer(){
    assert(this.drawTarget, 'Layer requires a target');
    const pattern = this.drawTarget.node.pattern;
    assert(this.drawLayer < pattern.layers.length, 'Invalid draw layer');
    return pattern.layers[this.drawLayer];
  },

  getBrushRadius(){
    return spaceX * 2 / this.transform.k; // XXX modulate with scale from UI
  },

  drawPatternStitches(stitches, fillColor, strokeColor){
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    assert(fillColor != -1, 'Need a fillColor, or layer ID to get it from');
    assert(['number', 'string'].includes(typeof fillColor), 'Invalid fillColor argument');
    const ctx = this.frontContext;
    for(const stitch of stitches){
      const bed = this.data.stitchMap[stitch.id];
      const { index, side } = bed.needleOf(stitch);
      assert(side == firstSide, 'Drawing pattern stitches from back');
      const { x, y } = this.getPosition(bed.time, index, 0);
      const r = 3;
      // highlight selection
      ctx.beginPath();
      if(typeof fillColor == 'string')
        ctx.fillStyle = fillColor;
      else {
        const instrList = stitch.meta(fillColor, 'pattern');
        const instr = instrList[instrList.length - 1];
        ctx.fillStyle = instr ? patternColor(instr) : 'white';
        strokeColor = instr ? 'black' : 'white';
      }
      if(strokeColor)
        ctx.strokeStyle = strokeColor; // 'rgb(220, 255, 128)';
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if(strokeColor)
        ctx.stroke();
    }
  },

  drawCurrentLayer(){
    if(!this.drawTarget){
      return;
    }
    const layer = this.currentPatternLayer();
    if(!layer)
      return;
    const layerID = layer.id;
    const node = this.drawTarget.node;
    const { groups } = this.data.nodeMap[node.id];
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    for(let i = 0; i < groups.length; ++i){
      const grp = groups[i];
      this.drawPatternStitches(grp.filterStitches(s => {
        return grp.needleOf(s).side == firstSide;
      }), layerID); // , 'white');
    }
  },

  drawBrush(){
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    // check for drawing target first
    if(!this.drawTarget){
      const nbed = this.data.at(this.targetTime);
      const groups = nbed.groupsAt(this.targetIndex, firstSide);
      this.canvas.style.cursor = groups.length ? 'pointer' : 'default';
      return;
    }
    // check for drawing layer type
    const currLayer = this.currentPatternLayer();
    if(currLayer.type == UserPattern.PROGRAM){
      this.canvas.style.cursor = 'context-menu';
      return;
    }
    // else potentially put default cursor back
    if(this.canvas.style.cursor != 'default')
      this.canvas.style.cursor = 'default';
    // draw actual brush for the given action
    const ctx = this.frontContext;
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(220, 255, 128)';
    ctx.fillStyle   = 'rgba(255, 255, 255, 0.5)';
    let x = this.mouseLeft * spaceX;
    let y = -this.mouseTime * spaceY;
    let r = this.getBrushRadius();
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if(this.actionTarget)
      ctx.stroke();
  },

  drawPattern(){
    // draw current layer
    this.drawCurrentLayer();

    // if not dragging then nothing else but the brush
    if(!this.actionTarget || !this.dragging){
      switch(this.instr){
        case Tool.MOVE:
        case Tool.RESIZE:
          return;
      }
      this.drawBrush();
      return;
    }

    switch(this.instr){
      case Tool.MOVE:   this.drawPatternMove(); return;
      case Tool.RESIZE: this.drawPatternResize(); return;
      default: break;
    }
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    const { groups, changes } = this.actionTarget;
    // 1. update selection
    // figure out new selection and add to changes
    const { x: cx, y: cy } = this.getPosition(this.mouseTime, this.mouseIndex, 0);
    const radius = this.getBrushRadius();
    switch(this.brushType || 'round'){
      // XXX implement different brush types
      // - square
      // - hline
      // - vline
      // - user images
      case 'round':
        /* falls through */
      default: {
        for(let i = 0; i < groups.length; ++i){
          const g = groups[i];
          const t = g.time;
          // const bed = this.data.timeline[t];
          for(let stitch of g.stitches()){
            const { index, side } = g.needleOf(stitch);
            if(side != firstSide)
              continue;
            // check within brush mask
            let { x, y } = this.getPosition(t, index, 0);
            if(squareOf(x - cx) + squareOf(y - cy) <= squareOf(radius)){
              changes.add(stitch);
            }
          } // endfor j < stitches length
        } // endfor i < groups length
      } break;
    } // endswitch type

    // 2. highlight current selection
    const color = patternColor(this.instr, 0);
    this.drawPatternStitches(changes, color, 'rgb(220, 255, 128)');

    // draw brush at end
    this.drawBrush();

  },

  drawPatternMove() {
    const { srcTime, srcIndex } = this.actionTarget;
    const { x: startX, y: startY } = this.getPosition(srcTime, srcIndex, 0);
    const { x: endX, y: endY } = this.getPosition(this.targetTime, this.targetIndex, 0);
    if(startX == endX && startY == endY)
      return;
    // draw arrow
    const ctx = this.frontContext;
    for(let [style, width, move] of [
      ['#FFF', 2, true],
      ['#99F', 1.5, true]
    ]){
      ctx.beginPath();
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      drawArrow(ctx, startX, startY, endX, endY, move);
      ctx.stroke();
    }
  },

  drawPatternResize() {
    const { groups, srcTime, srcIndex } = this.actionTarget;
    const dt = this.targetTime - srcTime;
    const di = this.targetIndex - srcIndex;
    const { x: startX, y: startY } = this.getPosition(srcTime, srcIndex, 0);
    const { x: endX, y: endY } = this.getPosition(this.targetTime, this.targetIndex, 0);
    if(dt == 0 && di == 0)
      return;
    // draw arrow
    const ctx = this.frontContext;
    for(let [style, width, move] of [
      ['#FFF', 2, true],
      ['#99F', 1.5, true]
    ]){
      ctx.beginPath();
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      drawArrow(ctx, startX, startY, endX, endY, move);
      ctx.stroke();
    }

    // highlight stitches that get expanded
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    for(let i = 0; i < groups.length; ++i){
      const t = groups[i].time;
      if((srcTime - t) * dt < 0)
        continue;
      const grp = groups[i];
      this.drawPatternStitches(grp.filterStitches(s => {
        const { index, side } = grp.needleOf(s);
        if(side != firstSide)
          return false;
        return (srcIndex - index) * di >= 0;
      }), '#99F', 'white'); // , 'white');
    }
  },

  drawStop(actionTarget){
    const firstSide = SIDE_FROM_STR[this.sides[0]]; // only act on front-side bed
    const { groups, changes, srcTime, srcIndex } = actionTarget;
    const layer = this.currentPatternLayer();
    assert(layer, 'Action on invalid layer');
    switch(this.instr){

      case Tool.MOVE: {
        const dt = this.targetTime - srcTime;
        const di = this.invertX ? srcIndex - this.targetIndex : this.targetIndex - srcIndex;
        if(dt == 0 && di == 0)
          break; // no change
        const data = layer.data.map((side, s) => {
          if(s != firstSide)
            return side;
          else {
            return side.map((row, t) => row.map((instr, i) => {
              const newRow = side[t - dt];
              return newRow ? newRow[i - di] || 0 : 0;
            }));
          }
        });
        layer.data = data;
      } break;

      case Tool.RESIZE: {
        const dt = this.targetTime - srcTime;
        const di = this.invertX ? srcIndex - this.targetIndex : this.targetIndex - srcIndex;
        if(dt == 0 && di == 0){
          // no change, just apply to resample grid of same size
          layer.updateFromGroup(groups[0].parent);
          break;
        }
        const data = layer.data.map((side, s) => {
          if(s != firstSide)
            return side;
          else {
            let rows = side;
            if(dt < 0){
              rows.splice(0, Math.abs(dt));
            } else if(dt > 0){
              rows.splice(rows.length - dt, Math.abs(dt));
            }
            return rows.map(row => {
              let cols = row;
              if(di < 0){
                cols.splice(0, Math.abs(di));
              } else if(di > 0){
                cols.splice(cols.length - di, Math.abs(di));
              }
              return cols;
            });
          }
        });
        layer.data = data;
      } break;

      default: {
        for(let stitch of changes){
          stitch.meta(layer.id, 'pattern', this.instr);
        }
        layer.updateFromGroup(groups[0].parent);
      } break;
    }
    renderSkeleton(true);
  },

};
