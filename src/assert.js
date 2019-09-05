// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// local storage
let globalErrors = [];
let localErrors = {};

function assertFunction(namespace){
  let errorList;
  if(namespace){
    if(namespace in localErrors)
      errorList = localErrors[namespace];
    else {
      errorList = localErrors[namespace] = [];
    }
  } else {
    errorList = globalErrors;
  }
  let assert = function(predicate, ...args){
    if(!predicate)
      errorList.push({ time: +new Date(), args });
    console.assert(predicate, ...args);
  };
  assert.as = function(subspace){
    return assertFunction(namespace ? namespace + '/' + subspace : subspace);
  };
  assert.raise =
  assert.error = function(...args){
    errorList.push({ time: +new Date(), args });
    console.assert(false, ...args);
  };
  assert.errorList = function(){
    return errorList.slice();
  };
  assert.clear = function(){
    errorList.splice(0, errorList.length);
  };
  assert.clearAll = function(){
    globalErrors.splice(0, globalErrors.length);
    for(let name in localErrors){
      let errList = localErrors[name];
      errList.splice(0, errList.length);
    }
  };
  return assert;
}

module.exports = assertFunction();
