import { gql } from "@apollo/client";

export const SUBSCRIBE_NOW_PLAYING = gql`
  subscription SubscribeNowPlaying {
    radio_play_history(limit: 1, order_by: { played_at: desc }) {
      id
      artist
      title
      dj
      played_at
      track_id
    }
  }
`;

export const SUBSCRIBE_LISTENERS = gql`
  subscription SubscribeListeners {
    radio_listener_snapshots(limit: 1, order_by: { recorded_at: desc }) {
      id
      count
      peak
      recorded_at
    }
  }
`;

export const SUBSCRIBE_PLAY_HISTORY = gql`
  subscription SubscribePlayHistory($limit: Int = 50) {
    radio_play_history(limit: $limit, order_by: { played_at: desc }) {
      id
      artist
      title
      dj
      played_at
      track_id
    }
  }
`;
