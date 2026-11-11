CREATE TABLE meeting_speaker_analysis (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    analysis TEXT NOT NULL,
    names TEXT NOT NULL DEFAULT '{}'
);
