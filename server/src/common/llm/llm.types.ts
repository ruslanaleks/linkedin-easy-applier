export interface ToneSettings {
  serious: number;
  humor: number;
  personal: number;
  provocative: number;
  length: 'short' | 'medium' | 'long';
}

export interface GeneratePostParams {
  mode: 'single_topic' | 'aggregated';
  sourcePosts: {
    authorName: string;
    content: string;
    reactions: number;
  }[];
  toneSettings: ToneSettings;
  extraContext?: string;
  topicLabels: string[];
}

export interface ExtractedTopic {
  label: string;
  confidence: number;
}
