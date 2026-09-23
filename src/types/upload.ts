export type UploadStatus =
  | 'pending_mapping'
  | 'parsing'
  | 'completed'
  | 'failed'
  | 'deleted';

export type ItemsMode = 'packed' | 'line-per-row';

export interface ColumnMapping {
  receiptId?: string;
  date?: string;
  time?: string;
  items?: string;
  total?: string;
  tip?: string;
  discount?: string;
  paymentMethod?: string;
  status?: string;
  quantity?: string;
}

export interface UploadStats {
  imported: number;
  skipped: number;
  errors: number;
  totalRows: number;
  /** Why rows were skipped, keyed by reason (e.g. status_not_approved: 2).
   *  'skipped: 2' alone was a number with no explanation attached. */
  skippedByReason?: Record<string, number>;
}

export interface UploadRowError {
  rowNumber?: number;
  reason: string;
  raw?: Record<string, unknown>;
}

export interface UploadDateRange {
  firstDate?: string;
  lastDate?: string;
  firstDateKey?: string;
  lastDateKey?: string;
}

export interface Upload {
  _id: string;
  cafeId: string;
  uploadedBy: { _id: string; name: string; email: string } | string;
  fileName: string;
  fileSize: number;
  r2Key: string;
  posType: 'yoco' | 'wizard';
  /** Absent until a mapping is resolved. An upload staged from an unknown format
   *  carries none, and declaring this required is why a crash in the wizard got
   *  past the compiler. */
  columnMapping?: ColumnMapping;
  itemsMode: ItemsMode;
  status: UploadStatus;
  /** How the column mapping was arrived at. Absent on uploads staged before this was recorded. */
  mappingSource?: 'yoco' | 'saved' | 'ai' | 'manual' | 'none';
  stats: UploadStats;
  dateRange: UploadDateRange;
  errorMessage?: string;
  rowErrors?: UploadRowError[];
  headers?: string[];
  sampleRows?: Record<string, string>[];
  createdAt: string;
  completedAt?: string;
  maintenance?: {
    status: 'not_started' | 'queued' | 'running' | 'completed' | 'partial_failure';
    attempts?: number;
    errors?: string[];
    startedAt?: string;
    completedAt?: string;
    nextRetryAt?: string;
    retryExhaustedAt?: string;
  };
}

/**
 * One row of GET /uploads. The list returns only what the history table draws;
 * previews, headers, row errors and the mapping come from GET /uploads/:id.
 */
export type UploadListItem = Pick<
  Upload,
  | '_id' | 'cafeId' | 'uploadedBy' | 'fileName' | 'fileSize' | 'posType' | 'mappingSource' | 'itemsMode'
  | 'status' | 'stats' | 'dateRange' | 'errorMessage' | 'completedAt' | 'maintenance' | 'createdAt'
>

export interface StageUploadResponse {
  success: true;
  uploadId: string;
  posType: 'yoco' | 'wizard';
  columnMapping: ColumnMapping;
  itemsMode: ItemsMode;
  headers: string[];
  preview: Record<string, string>[];
  needsConfirmation: boolean;
  mappingAssistedByAi?: boolean;
  mappingCreditsUsed?: number;
}

/** Another completed upload whose days meet this one's (GET /uploads/:id/overlaps, BE-03-T02). */
export interface UploadOverlap { uploadId: string; fileName: string; firstDateKey?: string; lastDateKey?: string }

/** Rows re-admitted from overlapping uploads after a delete or remap. */
export interface ReadmissionSummary { rows: number; uploads: { uploadId: string; fileName: string; rows: number }[] }

export interface DeleteUploadResponse {
  success: true
  readmitted?: ReadmissionSummary
  readmissionQueued?: { uploadId: string; fileName: string }[]
}
