export const handlers={},commandsMap=new Map(),reveals=[],executed=[];
export let provider,view,disposed=0;
const listen=name=>callback=>{handlers[name]=callback;return {dispose(){disposed++;delete handlers[name];}};};
export const window={activeTextEditor:undefined,
 createTreeView(_id,options){provider=options.treeDataProvider;view={visible:true,reveal:async(node,options)=>{reveals.push({node,options});},onDidChangeVisibility:listen('visibility'),dispose(){disposed++;}};return view;},
 onDidChangeActiveTextEditor:listen('active'),onDidChangeTextEditorSelection:listen('selection'),onDidChangeTextEditorVisibleRanges:listen('ranges'),
 async showTextDocument(doc,options){window.lastShow={doc,options};window.activeTextEditor.document=doc;return window.activeTextEditor;}
};
export const workspace={asRelativePath:uri=>uri.toString(),onDidChangeTextDocument:listen('change'),async openTextDocument(){return window.activeTextEditor.document;}};
export const commands={registerCommand(name,callback){commandsMap.set(name,callback);return {dispose(){disposed++;commandsMap.delete(name);}};},async executeCommand(name,...args){executed.push({name,args});return commandsMap.get(name)?.(...args);}};
export class EventEmitter{event=()=>({dispose(){}});fire(){}dispose(){disposed++;}}
export class TreeItem{constructor(label,collapsibleState){this.label=label;this.collapsibleState=collapsibleState;}}
export const TreeItemCollapsibleState={None:0,Collapsed:1,Expanded:2};
export class Position{constructor(line,character){this.line=line;this.character=character;}}
export class Range{constructor(start,end){this.start=start;this.end=end;}}
export class Selection extends Range{constructor(start,end){super(start,end);this.active=end;}}
export const TextEditorRevealType={AtTop:1};
export function reset(){for(const key of Object.keys(handlers))delete handlers[key];commandsMap.clear();reveals.length=0;executed.length=0;disposed=0;window.activeTextEditor=undefined;}
export function editor(source,uri='file:///note.md',languageId='markdown'){
 let text=source;const result={viewColumn:2,selection:{active:{line:0}},document:{languageId,uri:{toString:()=>uri},version:1,lineCount:source.split('\n').length,getText:()=>text},revealRange(range,type){result.revealed={range,type};}};
 result.setText=value=>{text=value;result.document.version++;result.document.lineCount=value.split('\n').length;};return result;
}
