/* eslint-disable */

import type { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";
import * as types from "./graphql";

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
  "mutation InsertPlayEvent($artist: String!, $title: String!, $dj: String, $track_id: Int, $played_at: timestamptz) {\n  insert_radio_play_history_one(\n    object: {artist: $artist, title: $title, dj: $dj, track_id: $track_id, played_at: $played_at}\n  ) {\n    id\n    played_at\n  }\n}\n\nmutation InsertListenerSnapshot($count: Int!, $peak: Int!) {\n  insert_radio_listener_snapshots_one(object: {count: $count, peak: $peak}) {\n    id\n    recorded_at\n  }\n}\n\nmutation RequestSkip($track_id: Int) {\n  insert_radio_skip_requests_one(object: {track_id: $track_id}) {\n    id\n    requested_at\n  }\n}": typeof types.InsertPlayEventDocument;
  "query GetNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetPlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetListenerCount {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nquery RadioState {\n  radio_play_history(limit: 51, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n  }\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    count\n    peak\n    recorded_at\n  }\n}": typeof types.GetNowPlayingDocument;
  "subscription SubscribeNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nsubscription SubscribeListeners {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nsubscription SubscribePlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}": typeof types.SubscribeNowPlayingDocument;
};
const documents: Documents = {
  "mutation InsertPlayEvent($artist: String!, $title: String!, $dj: String, $track_id: Int, $played_at: timestamptz) {\n  insert_radio_play_history_one(\n    object: {artist: $artist, title: $title, dj: $dj, track_id: $track_id, played_at: $played_at}\n  ) {\n    id\n    played_at\n  }\n}\n\nmutation InsertListenerSnapshot($count: Int!, $peak: Int!) {\n  insert_radio_listener_snapshots_one(object: {count: $count, peak: $peak}) {\n    id\n    recorded_at\n  }\n}\n\nmutation RequestSkip($track_id: Int) {\n  insert_radio_skip_requests_one(object: {track_id: $track_id}) {\n    id\n    requested_at\n  }\n}":
    types.InsertPlayEventDocument,
  "query GetNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetPlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetListenerCount {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nquery RadioState {\n  radio_play_history(limit: 51, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n  }\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    count\n    peak\n    recorded_at\n  }\n}":
    types.GetNowPlayingDocument,
  "subscription SubscribeNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nsubscription SubscribeListeners {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nsubscription SubscribePlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}":
    types.SubscribeNowPlayingDocument,
};

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = gql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function gql(source: string): unknown;

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(
  source: "mutation InsertPlayEvent($artist: String!, $title: String!, $dj: String, $track_id: Int, $played_at: timestamptz) {\n  insert_radio_play_history_one(\n    object: {artist: $artist, title: $title, dj: $dj, track_id: $track_id, played_at: $played_at}\n  ) {\n    id\n    played_at\n  }\n}\n\nmutation InsertListenerSnapshot($count: Int!, $peak: Int!) {\n  insert_radio_listener_snapshots_one(object: {count: $count, peak: $peak}) {\n    id\n    recorded_at\n  }\n}\n\nmutation RequestSkip($track_id: Int) {\n  insert_radio_skip_requests_one(object: {track_id: $track_id}) {\n    id\n    requested_at\n  }\n}",
): (typeof documents)["mutation InsertPlayEvent($artist: String!, $title: String!, $dj: String, $track_id: Int, $played_at: timestamptz) {\n  insert_radio_play_history_one(\n    object: {artist: $artist, title: $title, dj: $dj, track_id: $track_id, played_at: $played_at}\n  ) {\n    id\n    played_at\n  }\n}\n\nmutation InsertListenerSnapshot($count: Int!, $peak: Int!) {\n  insert_radio_listener_snapshots_one(object: {count: $count, peak: $peak}) {\n    id\n    recorded_at\n  }\n}\n\nmutation RequestSkip($track_id: Int) {\n  insert_radio_skip_requests_one(object: {track_id: $track_id}) {\n    id\n    requested_at\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(
  source: "query GetNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetPlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetListenerCount {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nquery RadioState {\n  radio_play_history(limit: 51, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n  }\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    count\n    peak\n    recorded_at\n  }\n}",
): (typeof documents)["query GetNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetPlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nquery GetListenerCount {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nquery RadioState {\n  radio_play_history(limit: 51, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n  }\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    count\n    peak\n    recorded_at\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(
  source: "subscription SubscribeNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nsubscription SubscribeListeners {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nsubscription SubscribePlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}",
): (typeof documents)["subscription SubscribeNowPlaying {\n  radio_play_history(limit: 1, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}\n\nsubscription SubscribeListeners {\n  radio_listener_snapshots(limit: 1, order_by: {recorded_at: desc}) {\n    id\n    count\n    peak\n    recorded_at\n  }\n}\n\nsubscription SubscribePlayHistory($limit: Int = 50) {\n  radio_play_history(limit: $limit, order_by: {played_at: desc}) {\n    id\n    artist\n    title\n    dj\n    played_at\n    track_id\n  }\n}"];

export function gql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never;
