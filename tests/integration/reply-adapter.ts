// 仅供真实 Extension Host 验证生产边界；构建到临时 profile，不添加测试命令或发布入口。
export { performReplyAction } from "../../src/reply-controller.ts";
export { capture, editSnapshot, captureInsertion, insertAtSnapshot } from "../../src/editor.ts";
