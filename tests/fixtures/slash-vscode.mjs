export const notices=[],calls=[],handlers=new Map(),listeners=[];
export const commands={registerCommand(name,fn){handlers.set(name,fn);return {dispose(){handlers.delete(name);}};},async executeCommand(...args){calls.push(args);}};
const listen=fn=>{const item={fn,disposed:false};listeners.push(item);return {dispose(){item.disposed=true;}};};
export const window={showWarningMessage:async message=>{notices.push(message);},activeTextEditor:undefined,onDidChangeActiveTextEditor:listen,onDidChangeTextEditorSelection:listen};
export const workspace={onDidChangeTextDocument:listen};
export class Disposable{constructor(fn){this.fn=fn;}dispose(){this.fn();}}
export class Range{constructor(start,end){this.start=start;this.end=end;}}
export class SnippetString{value='';cursor=undefined;appendText(value){this.value+=value;return this;}appendTabstop(){this.cursor=this.value.length;return this;}}
