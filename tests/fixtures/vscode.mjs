export const env={remoteName:undefined};
export const workspace={workspaceFolders:[],isTrusted:true};
const activeListeners=new Set(),selectionListeners=new Set();
export const window={showQuickPick:async items=>items[0],onDidChangeActiveTextEditor(fn){activeListeners.add(fn);return {dispose(){activeListeners.delete(fn);}};},onDidChangeTextEditorSelection(fn){selectionListeners.add(fn);return {dispose(){selectionListeners.delete(fn);}};}};
export function emitActive(editor){window.activeTextEditor=editor;for(const fn of activeListeners)fn(editor);}
export function emitSelection(event){for(const fn of selectionListeners)fn(event);}
export class Range{constructor(start,end){this.start=start;this.end=end;}}
export class Selection extends Range{constructor(start,end){super(start,end);this.anchor=start;this.active=end;this.isEmpty=start.line===end.line&&start.character===end.character;}}
export class Disposable{constructor(callback){this.callback=callback;}dispose(){this.callback();}}
export const DecorationRangeBehavior={ClosedClosed:1};
