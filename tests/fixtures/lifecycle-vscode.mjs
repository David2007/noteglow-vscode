import {join} from 'node:path';
const waiters=[],registered=new Map();
export const notices=[],renders=[];export let provider,receive;
export const env={remoteName:undefined};
export const workspace={workspaceFolders:[],isTrusted:false,getConfiguration(){return {get:(_key,fallback)=>fallback};},onDidChangeWorkspaceFolders(){return {dispose(){}};},onDidChangeConfiguration(){return {dispose(){}};},onDidChangeTextDocument(){return {dispose(){}};},onDidCloseTextDocument(){return {dispose(){}};}};
export const window={activeTextEditor:undefined,visibleTextEditors:[],createTextEditorDecorationType(){return {dispose(){}};},onDidChangeVisibleTextEditors(){return {dispose(){}};},showInformationMessage:async()=>undefined,showOpenDialog:async()=>undefined,showErrorMessage(message){notices.push(message);return new Promise(()=>{});},registerWebviewViewProvider(_id,value){provider=value;return {dispose(){}};},onDidChangeTextEditorSelection(){return {dispose(){}};}};
export const commands={registerCommand(name,handler){registered.set(name,handler);return {dispose(){registered.delete(name);}};},async executeCommand(name,...args){return registered.get(name)?.(...args);}};
export const languages={registerCodeLensProvider(){return {dispose(){}};}};
export class Uri {constructor(path){this.fsPath=path;this.scheme='file';}toString(){return `file://${this.fsPath}`;}static file(path){return new Uri(path);}static joinPath(uri,...paths){return new Uri(join(uri.fsPath,...paths));}}
export class EventEmitter{event=()=>({dispose(){}});fire(){}dispose(){}}
export class Range{}export class Selection{}export class CodeLens{}
export const ConfigurationTarget={Global:1};
export function resolveView(extensionUri){
 const view={webview:{cspSource:'vscode-webview:',asWebviewUri:uri=>uri.toString(),onDidReceiveMessage(fn){receive=fn;return {dispose(){}};},postMessage(data){renders.push(structuredClone(data));for(const waiter of [...waiters])waiter(data);return Promise.resolve(true);}},onDidDispose(){return {dispose(){}};}};
 provider.resolveWebviewView(view);return view;
}

export function waitForRender(predicate){return new Promise((resolve,reject)=>{const inspect=state=>{if(!predicate(state))return;clearTimeout(timer);waiters.splice(waiters.indexOf(inspect),1);resolve(state);};const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(inspect),1);reject(Error('No matching render before deadline'));},3000);waiters.push(inspect);for(const state of renders)inspect(state);});}

export function reset(){notices.length=0;renders.length=0;registered.clear();workspace.isTrusted=false;window.showOpenDialog=async()=>undefined;}

export class Disposable {constructor(fn){this.fn=fn;}dispose(){this.fn();}}
export const DecorationRangeBehavior={ClosedClosed:1};
