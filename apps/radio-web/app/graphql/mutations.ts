import { gql } from "@apollo/client";

export const INSERT_PLAY_EVENT = gql`
  mutation InsertPlayEvent(
    $artist: String!
    $title: String!
    $dj: String
    $track_id: Int
    $played_at: timestamptz
  ) {
    insert_radio_play_history_one(
      object: {
        artist: $artist
        title: $title
        dj: $dj
        track_id: $track_id
        played_at: $played_at
      }
    ) {
      id
      played_at
    }
  }
`;

export const INSERT_LISTENER_SNAPSHOT = gql`
  mutation InsertListenerSnapshot($count: Int!, $peak: Int!) {
    insert_radio_listener_snapshots_one(
      object: { count: $count, peak: $peak }
    ) {
      id
      recorded_at
    }
  }
`;

export const REQUEST_SKIP = gql`
  mutation RequestSkip($track_id: Int) {
    insert_radio_skip_requests_one(object: { track_id: $track_id }) {
      id
      requested_at
    }
  }
`;
