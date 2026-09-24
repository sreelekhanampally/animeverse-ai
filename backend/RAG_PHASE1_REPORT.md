# AnimeVerse RAG Foundation — Phase 1

## What changed

AnimeVerse now has a real chunk-level retrieval layer instead of relying only on one embedding per Anime or Video document.

The new RAG path is:

```text
Anime / Video / eligible creator transcript
        ↓
deterministic chunking
        ↓
local MiniLM embedding
        ↓
RagChunk collection
        ↓
query embedding
        ↓
vector retrieval + Mongo text retrieval
        ↓
reciprocal-rank fusion
        ↓
deterministic reranking
        ↓
diverse context builder
        ↓
Gemini AnimeVerse knowledge tool
        ↓
grounded answer with [AV#] source ids
```

## Retrieval units

- `anime_metadata`: titles, aliases, genres, studios, characters, format/status/season
- `anime_synopsis`: synopsis split into bounded overlapping chunks
- `video_metadata`: stored title, description, tags, category, linked anime metadata
- `creator_transcript`: only legitimately stored transcripts from Cloudinary creator uploads

YouTube videos never produce transcript chunks. Their RAG representation is stored metadata only.

## Hybrid retrieval

The retrieval service uses two independent candidate paths:

1. Local MiniLM cosine similarity
2. MongoDB full-text search

Candidate lists are fused with weighted Reciprocal Rank Fusion and then reranked using semantic score, lexical coverage, and small source-aware boosts.

The context builder limits chunks per source document so a long synopsis or transcript cannot crowd every other source out of the prompt.

## Source provenance

Each returned context item carries:

- citation id such as `AV1`
- source type
- original Anime/Video id
- title
- bounded excerpt
- retrieval score
- semantic and lexical scores
- vector and lexical ranks

Embeddings are never returned by the API.

## Commands

Dry-run the index shape without writing:

```powershell
npm run rag:index:dry
```

Build/update the RAG index:

```powershell
npm run rag:index
```

Run focused tests:

```powershell
npm run test:rag
```

Health:

```http
GET /api/v1/ai/rag/health
```

Direct retrieval:

```http
POST /api/v1/ai/rag/search
Content-Type: application/json

{
  "query": "two brothers using alchemy trying to restore their bodies",
  "limit": 8
}
```

## Incremental indexing

The indexer hashes every chunk and records embedding provenance. An unchanged chunk with a compatible embedding is not re-embedded.

Each successful run receives an `indexRunId`. Stale chunks are removed only if the entire indexing run completes without failures. If any chunk fails, stale cleanup is skipped, preventing a partial indexing run from deleting valid knowledge.

## Assistant integration

Gemini now has a separate `search_animeverse_knowledge` tool.

The existing `search_animeverse_catalog` tool remains focused on discovering playable video cards. The new knowledge tool is for grounded factual retrieval.

For AnimeVerse-specific factual answers, Gemini is instructed to use the retrieved context, cite the supplied `[AV#]` ids, and state when stored evidence is insufficient rather than filling gaps from model memory.

## Why a separate RagChunk collection?

The existing Anime and Video embeddings remain useful for discovery and recommendations. Replacing them would mix two different jobs.

- document embeddings: discovery / similar videos / recommendation
- chunk embeddings: RAG context retrieval

Keeping them separate makes the retrieval unit explicit and lets transcripts or long synopses produce multiple retrievable chunks without changing the product search path.

## Current scaling choice

At the present catalogue size, vector similarity is computed in-process over the chunk collection. This keeps the project zero-cost and uses the same local MiniLM model as the existing semantic layer.

For a much larger corpus, the `RagChunk` model is intentionally isolated so its vector retrieval implementation can later be swapped for MongoDB Atlas Vector Search or a dedicated vector store without changing chunking, provenance, reranking, context construction, or Gemini tool contracts.
