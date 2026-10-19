export const env={remoteName:undefined};
export const workspace={workspaceFolders:[],isTrusted:true};
export const window={showQuickPick:async items=>items[0]};
export class Range{constructor(start,end){this.start=start;this.end=end;}}
export class Selection extends Range{constructor(start,end){super(start,end);this.isEmpty=start.line===end.line&&start.character===end.character;}}
export class Disposable{constructor(callback){this.callback=callback;}dispose(){this.callback();}}
export const DecorationRangeBehavior={ClosedClosed:1};
