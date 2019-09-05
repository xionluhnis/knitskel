// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const moment = require('moment');
const assert = require('../assert.js');
const env = require('../env.js');

// variables
const snapshots = [];
const intervalTime = 15000; // every 15s
let interval = -1;

function getHistoryType(){
  return document.getElementById('history-type').value;
}

function createSnapshot(label, type){
  if(!type)
    type = getHistoryType();
  else {
    // skip if not the correct type
    if(getHistoryType() != type && type != 'click')
      return;
  }
  if(!type || !type.length || type == 'none')
    return;
  let snap = env.serialize();
  if(!isDifferent(snap))
    return; // skip if the snapshot has nothing new (except its time)
  snap.time  = +new Date();
  snap.label = label || 'Snapshot';
  snap.type  = type;
  snapshots.push(snap);

  // update history UI if open
  if(!document.getElementById('history-editor').classList.contains('closed')){
    editHistory();
  }
}

function storeLocalSnapshot(snap){
  if(!snap)
    snap = snapshots[snapshots.length - 1];
  if(!snap)
    return; // nothing to do
  try {
    let store = window.localStorage;
    store.setItem('history', JSON.stringify(snap));
  } catch (err) {
    assert.error(err);
  }
}

function getLocalSnapshot(){
  let snap = null;
  try {
    let store = window.localStorage;
    let value = store.getItem('history');
    snap  = JSON.parse(value);

  } catch (err) {
    assert.error(err);
  }
  return snap;
}

function loadLocalSnapshot(){
  let snap = getLocalSnapshot();
  if(snap){
    snap.label = 'Previous session';
    snapshots.push(snap);
  }
}

function isDifferent(snap){
  return !snapshots.length
      || isDifferentFrom(snap, snapshots[snapshots.length - 1]);
      // || isDifferentFrom(snapshots[snapshots.length - 1], snap);
}

function isDifferentFrom(snap, other){
  let ctxQueue = Object.keys(snap).map(key => {
    return { key, src: snap, trg: other };
  });
  while(ctxQueue.length){
    let { key, src, trg } = ctxQueue.pop();
    if(key == 'time')
      continue; // do not treat those keys as different
    let srcVal = src[key];
    let trgVal = trg[key];
    let srcType = typeof srcVal;
    let trgType = typeof trgVal;
    // check types
    if(srcType !== trgType)
      return true;
    // typed check
    switch(srcType){
      case 'number':
      case 'string':
        if(srcVal !== trgVal)
          return true;
        break;
      default: {
        // undefined / null
        let isNull = false;
        for(let val of [null, undefined]){
          if(srcVal === val){
            isNull = true;
            if(trgVal !== val)
              return true;
          }
        }
        // null value cannot be introspected
        if(isNull)
          continue;
        // array
        if(Array.isArray(srcVal)){
          // check length
          if(srcVal.length !== trgVal.length)
            return true;
          // check all children values
          for(let i = 0; i < srcVal.length; ++i)
            ctxQueue.push({ key: i, src: srcVal, trg: trgVal });
        } else {
          // object
          let srcKeys = Object.keys(srcVal);
          let trgKeys = Object.keys(trgVal);
          // check number of keys
          if(srcKeys.length !== trgKeys.length)
            return true;
          // check all key values
          for(let newKey of srcKeys){
            // check that other has the key
            if(!(newKey in trgVal))
              return true;
            // check corresponding mapping
            ctxQueue.push({ key: newKey, src: srcVal, trg: trgVal });
          }
        }
      } break;
    }
    // the same up to this level
  }
  return false;
}

function editHistory(){
  const list = document.getElementById('history');
  // clear history list
  while(list.firstChild)
    list.removeChild(list.firstChild);
  // generate history list
  for(let i = 0; i < snapshots.length; ++i){
    let snap = snapshots[i];
    let item = document.createElement('li');
    // time information
    let time = document.createElement('span');
    time.className = 'time';
    time.textContent = moment(snap.time).fromNow();
    item.appendChild(time);
    // label
    let label = document.createElement('span');
    label.className = 'label';
    label.textContent = snap.label;
    item.appendChild(label);
    // summary
    let summary = document.createElement('span');
    summary.className = 'summary';
    summary.textContent = snap.skeleton.length + ' objects';
    item.appendChild(summary);
    // add all to list
    list.appendChild(item);
    item.onclick = () => {
      loadHistory(snap);
    };
  }

  let save = document.getElementById('save_history');
  save.onclick = function(){
    let str = JSON.stringify(snapshots);
    let blob = new Blob([str], {type: "octet/stream"});
    let url = URL.createObjectURL(blob);

    // breaks spaces: save.href = 'data:application/octet-stream,' + JSON.stringify(list);
    save.href = url;
    save.download = 'history.json';

    // revoke url after click
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };
  let load = document.getElementById('load_history');
  let file = document.getElementById('file_history');
  load.onclick = function(){
    file.click();
  };
  file.onchange = function(){
    loadHistoryFile(file.files[0]);
  };
}

function setHistoryType(type){
  clearInterval(interval);
  switch(type){
    case 'by-action':
      break;
    case 'by-time':
      interval = setInterval(() => {
        createSnapshot('Timed');
      }, intervalTime);
      break;
    default:
      // nothing to do
      return;
  }
  // if empty history, create initial snapshot
  if(snapshots.length === 0){
    createSnapshot('Initial', type);
  }
}

function loadHistory(snap, noSnapshot){
  // load serialized history
  env.load(snap);

  // if history on, this creates a new history snapshot
  if(!noSnapshot){
    let idx = snapshots.indexOf(snap);
    createSnapshot('Load (' + (idx != -1 ? idx + 1 : '?') + ')', 'click');
  }

  // update ui
  require('./skeleton.js').renderSkeleton(true, true);
}

let lastBlob = null;
function loadHistoryFile(blob){
  if(!blob)
    blob = lastBlob;
  if(!blob)
    return;
  let reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(!data)
      return;
    let list;
    try {
      list = JSON.parse(data);
    } catch(err){
      console.log('Error while loading history file:', err);
      return;
    }
    if(!list){
      console.log('Invalid history file');
      return;
    }
    if(!Array.isArray(list)){
      console.log('History file must contain an array of snapshots');
      return;
    }
    // replace current snapshots
    snapshots.splice(0, snapshots.length);
    snapshots.push(...list);

    // loading the last snapshot, without creating a new one for that
    loadHistory(snapshots[snapshots.length-1], true);

    // update this panel
    editHistory();
  };
  reader.readAsText(blob);
}

module.exports = {
  createSnapshot,
  editHistory,
  setHistoryType,
  getLocalSnapshot,
  loadLocalSnapshot,
  storeLocalSnapshot
};
