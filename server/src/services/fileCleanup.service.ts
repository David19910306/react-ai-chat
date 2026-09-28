/**
 * 孤儿附件回收
 *
 * 「孤儿」的定义是：file 表里有记录，但没有任何 message_file 指向它，且已经超过保留时长。
 * 产生原因是上传和发送是两步——multer 一落盘就入库，消息则要等用户真的点发送才建立绑定。
 * 用户在中间任何一个环节退出（传完就关页面、传错文件、只是想试试），
 * 这条记录和磁盘上的那份就永远没人认领了。
 *
 * 回收范围是全库的，不区分用户：判据「没有任何消息引用它」本身就已经足够安全，
 * 再加上一层 create_by 反而没法命中（清理任务不知道也不该关心是谁传的）。
 */
import { ORPHAN_FILE_TTL_HOURS } from '../config';
import { findOrphanFiles, purgeFileById } from './file.service';
import { removeUploadedFile } from '../utils/file';

// 单轮最多回收多少个：分批是为了不把一批上万条的删除和 unlink 堆在一个事件循环周期里，
// 也和 SSE 流式响应共享同一个进程，长时间同步 I/O 会拖慢所有人的对话
const CLEANUP_BATCH = 200;
// 检查间隔。取整小时：判据是 24 小时的窗口，扫得太勤没有意义，只是白跑 SQL
const CLEANUP_INTERVAL = 60 * 60 * 1000;

/**
 * 跑一轮回收，返回实际删掉的文件数。
 *
 * 抽成独立的导出函数而不是藏在定时器里：可以在不启动服务的情况下直接调用来验证，
 * 也是唯一需要单测的逻辑
 */
async function cleanupOrphanFiles(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_FILE_TTL_HOURS * 3600 * 1000);
  const orphans = await findOrphanFiles(cutoff, CLEANUP_BATCH);
  if (orphans.length === 0) return 0;

  let removed = 0;
  for (const orphan of orphans) {
    /**
     * 先删库、再删盘，和 deleteFile 里的顺序一致：反过来的话，
     * 磁盘删成功而删库失败会留下一条指向空文件的记录，界面上能看到、点开是 404，
     * 比单纯残留一个磁盘文件更难解释（用户会以为是功能坏了，而不是残留）
     */
    const deleted = await purgeFileById(orphan.fileId);
    // 返回 false 说明这一行已经不在了（用户自己删了、或另一个清理周期已经处理过），
    // 这时不去碰磁盘：不能确认那个路径还是我们记录的那个文件
    if (!deleted) continue;

    await removeUploadedFile(orphan.storagePath);
    removed += 1;
  }

  return removed;
}

/**
 * 启动定时回收，返回停止函数（供优雅关闭时调用）。
 *
 * 单实例假设：多进程部署时每个进程都会跑同一轮扫描，purgeFileById 的 affectedRows
 * 判断保证只有一方会去删磁盘，所以不会互相删坏，只是白跑几次查询。
 * 真要上多实例应该换成带 leader 选举的调度，这里不做过度设计。
 */
function startOrphanFileCleanup(): () => void {
  const runOnce = (reason: string) => {
    cleanupOrphanFiles()
      .then((removed) => {
        if (removed > 0) console.log(`附件回收（${reason}）：清理了 ${removed} 个未使用的文件`);
      })
      // 清理失败不该影响服务运行，记日志即可。加上 catch 是因为
      // 未处理的 promise rejection 在 Node 下会直接终止进程
      .catch((error) => console.error(`附件回收失败（${reason}）:`, error));
  };

  // 启动时先跑一轮。dev 下 tsx watch 每次改文件都会重启，看起来跑得很勤，
  // 但第一轮之后就没有候选了，重复执行只是一次走索引的空查询
  runOnce('启动');

  const timer = setInterval(() => runOnce('定时'), CLEANUP_INTERVAL);
  // 不因为定时器本身拖住进程退出（否则 Ctrl+C 之后还要等下一次触发）
  timer.unref();

  return () => clearInterval(timer);
}

export { cleanupOrphanFiles, startOrphanFileCleanup };
