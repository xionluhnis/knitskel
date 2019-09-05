// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const Concrete = require('concretejs');
const Function1D = require('../fun1d.js');
const env = require('../env.js');

// constants
const width = 600;
const height = 200;
const margin = 10;
let scale = 1;
function funToViewX(x){
  return margin + x * (width-2*margin);
}
function viewToFunX(x){
  return Math.max(0, Math.min(1, (x-margin)/(width-2*margin) ));
}
function funToViewY(y, s){
  return margin + y * (height-2*margin) / (s || scale);
}
function viewToFunY(y, s){
  return Math.max(0, Math.min(height, (y-margin) / (height-2*margin) * (s || scale) ));
}

let viewport = null;
let layer = null;
let lastIndex = 0;
let clicking = true;
let dragging = false;
let lastMouse = { x: 0, y: 0 };
let mouse = { x: 0, y: 0 };
let selectedIndex = -1;

function editFunction(node, propName, arrayIdx){
  let editor = document.querySelector('#function-editor');
  assert(editor, 'Missing sub-editor for function, prop=' + propName);
  env.openPanel('function');

  if(!viewport){
    viewport = new Concrete.Viewport({
      width: width, height: height,
      container: document.getElementById('function')
    });
    viewport.add(layer = new Concrete.Layer());
  }

  // set the function's name
  let namePrefix = arrayIdx !== undefined ? '[' + arrayIdx + ']' : '';
  editor.querySelector('#fname').textContent = namePrefix + propName;

  // read function definition
  let fun = node[propName];
  if(arrayIdx !== undefined)
    fun = fun[arrayIdx];
  // point version
  fun = fun.getPoints();
  
  // scale of ui
  updateScale(fun);

  // draw
  let samples = 10;
  if('length' in node){
    samples = Math.round(node.length);
  }
  drawFunction(fun, samples);

  // set UI interaction
  let indices = editor.querySelector('#function-index');
  let value = editor.querySelector('#function-value');

  // update index list
  while(indices.firstChild)
    indices.removeChild(indices.firstChild);
  fun.forEach((v, idx) => {
    if(idx % 2 == 1)
      return; // skip values
    let option = document.createElement('option');
    option.value = idx / 2;
    option.textContent = v;
    indices.appendChild(option);
  });
  console.log('lastIndex: ' + lastIndex);
  let idx = (lastIndex && 2*lastIndex+1 < fun.length) ? lastIndex : 0;
  indices.value = idx;

  // update value
  value.value = fun[2*idx+1];

  indices.onchange = function(){
    lastIndex = parseInt(indices.value) || 0; // remember
    value.value = fun[2 * indices.value + 1];
    editFunction(node, propName, arrayIdx);
  };
  value.onchange = function(){
    fun[2*indices.value + 1] = parseFloat(value.value);
    updateFunction(node, propName, arrayIdx, fun);
  };

  // index shift for intermediate values
  let canChange = idx > 0 && 2*idx+2 < fun.length;
  if(canChange){
    // middle value => can be moved
    let change = editor.querySelector('#function-index-change');
    change.min = fun[(idx-1)*2];
    change.max = fun[(idx+1)*2];
    change.value = fun[idx*2];
    change.onchange = function(){
      fun[2*idx] = parseFloat(change.value);
      updateFunction(node, propName, arrayIdx, fun, true);
    };
  }
  editor.querySelectorAll('.change').forEach(e => {
    e.style.display = canChange ? 'initial' : 'none';
  });

  // adding new intermediate value
  let create = editor.querySelector('#function-create');
  create.onclick = function(){
    if(2*idx + 2 >= fun.length){
      // insert before current
      let t = (fun[(idx-1)*2+0] + fun[(idx+0)*2+0])/2;
      let y0 = fun[(idx-1)*2+1];
      let y1 = fun[(idx+0)*2+1];
      let y = y0 == y1 ? y0 + 1 : (y0 + y1)/2;
      fun.splice(idx*2, 0, t, y);
      // do not move index, as we're going backward
    } else {
      // insert after current
      let t = (fun[(idx+0)*2+0] + fun[(idx+1)*2+0])/2;
      let y0 = fun[(idx+0)*2+1];
      let y1 = fun[(idx+1)*2+1];
      let y = y0 == y1 ? y0 + 1 : (y0 + y1)/2;
      fun.splice(idx*2+2, 0, t, y);
      // move index to new element
      lastIndex = idx + 1;
    }
    updateFunction(node, propName, arrayIdx, fun, true); // reset editor
  };

  // deleting intermediate value
  let remove = editor.querySelector('#function-delete');
  remove.style.display = canChange ? 'inline-block' : 'none';
  remove.onclick = canChange ? function(){
    fun.splice(idx*2, 2);
    updateFunction(node, propName, arrayIdx, fun, true); // reset editor
  } : function(){};
  
  // interaction with function nodes
  viewport.scene.canvas.onmousemove = function(event){
    lastMouse.x = mouse.x;
    lastMouse.y = mouse.y;
    mouse.x = event.offsetX;
    mouse.y = event.offsetY;
    // console.log('mouse at ' + mouse.x + '/' + mouse.y);
    // drawFunction(fun, samples);
    if(clicking)
      dragging = true;
    // move data point
    if(dragging && selectedIndex >= 0){
      // move y value
      let y = viewToFunY(height - mouse.y);
      y = Math.round(y * 100) / 100; // reduce to 0.01 precision
      fun[2*selectedIndex+1] = y;
      // move x value only within range (and for intermediate values)
      if(selectedIndex > 0 && 2*selectedIndex+2 < fun.length){
        let x = viewToFunX(mouse.x);
        let minX = fun[2*selectedIndex-2];
        let maxX = fun[2*selectedIndex+2];
        // reduce to 0.01 precision
        x = Math.round(x * 100) / 100;
        fun[2*selectedIndex] = Math.max(minX, Math.min(maxX, x));
      }
    }
    drawFunction(fun, samples);
  };
  viewport.scene.canvas.onmousedown = function(){
    clicking = true;
    // hit testing
    let key = layer.hit.getIntersection(mouse.x || 0, mouse.y || 0);
    if(key !== null){
      selectedIndex = parseInt(key + '');
    } else {
      selectedIndex = -1;
    }
  };
  viewport.scene.canvas.onmouseout = function(){
    clicking = dragging = false;
    selectedIndex = -1;
  };
  viewport.scene.canvas.onmouseup = function(){
    clicking = dragging = false;
    if(selectedIndex >= 0){
      lastIndex = selectedIndex;
    }
    selectedIndex = -1;
    // update function
    updateFunction(node, propName, arrayIdx, fun, true);
  };
  // adding function node
  viewport.scene.canvas.ondblclick = function(){
    let y = viewToFunY(height - mouse.y);
    y = Math.round(y * 100) / 100;
    let x = viewToFunX(mouse.x);
    x = Math.round(x * 100) / 100;
    // find index range
    let t = findFunctionIndex(fun, x);
    if(!Array.isArray(t))
      return; // skip exact values
    fun.splice(t[1], 0, x, y);
    lastIndex = t[1] / 2;
    updateFunction(node, propName, arrayIdx, fun, true); // and reset interface
  };
}

function updateScale(points){
  let maxY = points[1];
  for(let i = 1; i < points.length; i += 2)
    maxY = Math.max(maxY, points[i]);
  scale = Math.max(1, maxY * 1.5);
}

function updateFunction(node, propName, arrayIdx, fun, reset){
  // update property value (trigger setter => update function)
  if(arrayIdx !== undefined)
    node[propName][arrayIdx].update = fun;
  else
    node[propName] = fun;

  // update scale
  updateScale(fun);

  // update visualization
  if(reset)
    editFunction(node, propName, arrayIdx);
  else {
    let samples = 10;
    if('length' in node)
      samples = Math.round(node.length);
    drawFunction(fun, samples);
  }

  // update skeleton
  const { renderSkeleton } = require('./skeleton.js');
  renderSkeleton(true);
}

function findFunctionIndex(points, t){
  if(points.length == 1)
    return 0; // constant wrapped in array
  if(t <= 0)
    return 0; // exact element
  if(t >= 1)
    return points.length-2;
  // search location
  for(let i = 2; i < points.length; i += 2){
    let x_p = points[i-2];
    let x_i = points[i+0];
    if(t == x_i)
      return i;
    if(t > x_p && t < x_i){
      return [i-2, i];
    }
  }
  throw "Invalid index state";
}


function drawFunction(points, samples){
  samples = Math.max(3, samples);
  // clear all
  layer.scene.clear();
  layer.hit.clear();

  let gfx = layer.scene.context;
  let hfx = layer.hit.context;

  // draw samples in back
  gfx.save();
  hfx.save();
  gfx.transform(1, 0, 0, -1, 0, height);
  hfx.transform(1, 0, 0, -1, 0, height);
  // hfx.transform(1, 0, 0, -1, 0, height);
  const deltaX = 1/samples;
  const deltaT = 1/(samples-1);
  for(let i = 0, x = 0, t = 0; i < samples; ++i){
    // linear interpolation of samples in between function points
    let x0 = funToViewX(x);
    let f = Function1D.from(points).eval(t);
    t += deltaT;
    x += deltaX;
    let x1 = funToViewX(x);
    let y = funToViewY(f);
    gfx.fillStyle = '#0099FF'; // '#F1FFAF';
    gfx.fillRect(x0+1, margin, x1-x0-2, y-margin);
  }
  
  // draw polyline in middle
  gfx.strokeStyle = '#000';
  gfx.strokeWidth = 2;
  gfx.beginPath();
  gfx.moveTo(funToViewX(points[0]), funToViewY(points[1]));
  for(let i = 2; i < points.length; i += 2){
    gfx.lineTo(funToViewX(points[i+0]), funToViewY(points[i+1]));
  }
  gfx.lineWidth = 2;
  gfx.stroke();

  // draw vertices in front
  for(let i = 0; i < points.length; i += 2){
    let x = funToViewX(points[i+0]);
    let y = funToViewY(points[i+1]);
    // hit
    hfx.beginPath();
    hfx.arc(x, y, 7, 0, Math.PI * 2, false);
    hfx.fillStyle = layer.hit.getColorFromIndex(i/2);
    hfx.fill();

    // selection detection
    let selection = selectedIndex;
    if(selection < 0){
      // check for "hovering"
      let key = layer.hit.getIntersection(mouse.x || 0, mouse.y || 0);
      if(key !== null){
        selection = parseInt(key + '');
      }
    }

    // node drawing
    gfx.beginPath();
    gfx.arc(x, y, 7, 0, Math.PI * 2, false);
    gfx.strokeStyle = i/2 == selection ? '#F1FFAF' : '#0044AA'; // '#F1FFAF'; // '#0091FF';
    gfx.lineWidth = 4;
    gfx.stroke();
    if(i/2 == selectedIndex){
      gfx.fillStyle = '#0044AA';
      gfx.fill();
    }
  }
  gfx.restore();
  hfx.restore();
  viewport.render();
}

// export
module.exports = editFunction;
