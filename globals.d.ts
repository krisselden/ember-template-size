interface SharedCode {
  version: string;
  filename: string;
  code: SharedArrayBuffer;
  cachedData: SharedArrayBuffer;
}

interface CompileResult {
  filename: string;
  version: string;
  original: number;
  compiled: number;
  gzip: number;
  brotli: number;
}

type SummarizedResult = Pick<
  CompileResult,
  Exclude<keyof CompileResult, "filename">
>;
