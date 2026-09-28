/**
 * 浏览器侧的本地文件工具
 */
import SparkMD5 from 'spark-md5';

// 分片大小。2MB 是「读一片的耗时可忽略」和「片数不至于太多」之间的折中：
// 20MB 的文件切成 10 片，每片十几毫秒，中间能让出主线程让页面保持响应
const CHUNK_SIZE = 2 * 1024 * 1024;

/**
 * 算文件的 md5，用于秒传探测。
 *
 * 用 spark-md5 而不是 WebCrypto：crypto.subtle.digest 支持的算法里没有 MD5
 * （只有 SHA-1/256/384/512），而服务端落库的指纹就是 md5，换算法要同时动表结构、
 * 既有数据和回收任务的判据。
 *
 * 分片累加而不是 file.arrayBuffer() 一次读完：实际上限是 20MB，
 * 一次性读进来就要占住 20MB 内存直到算完，用户连着选几个文件时很容易堆起来。
 * 分片是异步的，算的过程中页面不会卡死
 */
export async function calcFileMd5(file: File): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    spark.append(await chunk.arrayBuffer());
  }
  return spark.end();
}
