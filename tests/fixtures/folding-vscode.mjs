export const notices=[],calls=[],handlers=new Map(),events={},options={autoFoldMetadata:true,folding:true,foldingStrategy:'auto'};
export let provider,activate=async()=>{};
export function activation(fn){activate=fn;}
const listen=name=>fn=>{events[name]=fn;return {dispose(){delete events[name];}};};
export const window={activeTextEditor:undefined,visibleTextEditors:[],showWarningMessage:async message=>{notices.push(message);},onDidChangeTextEditorSelection:listen('selection'),onDidChangeActiveTextEditor:listen('active'),onDidChangeVisibleTextEditors:listen('visible')};
export const workspace={getConfiguration:()=>({get:(key,fallback)=>options[key]??fallback}),onDidChangeTextDocument:listen('document'),onDidCloseTextDocument:listen('close'),onDidChangeConfiguration:listen('configuration')};
export const commands={registerCommand(name,fn){handlers.set(name,fn);return {dispose(){handlers.delete(name);}};},async executeCommand(name,arg){calls.push([name,arg]);if(name==='vscode.executeFoldingRangeProvider')return provider?.provideFoldingRanges(window.activeTextEditor.document);}};
export const extensions={getExtension:()=>({activate:()=>activate()})};
export const languages={registerFoldingRangeProvider(_selector,value){provider=value;return {dispose(){provider=undefined;}};}};
export class EventEmitter{event=()=>({dispose(){}});fire(){}dispose(){}}
export class Disposable{constructor(fn){this.fn=fn;}dispose(){this.fn();}}
export class FoldingRange{constructor(start,end,kind){this.start=start;this.end=end;this.kind=kind;}}
export const FoldingRangeKind={Comment:1};
export function reset(){notices.length=0;calls.length=0;handlers.clear();provider=undefined;activate=async()=>{};window.activeTextEditor=undefined;window.visibleTextEditors=[];options.autoFoldMetadata=true;options.folding=true;options.foldingStrategy='auto';}
