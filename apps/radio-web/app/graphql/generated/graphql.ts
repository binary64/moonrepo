/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  timestamptz: { input: any; output: any };
};

/** Boolean expression to compare columns of type "Float". All fields are combined with logical 'AND'. */
export type Float_Comparison_Exp = {
  _eq?: InputMaybe<Scalars["Float"]["input"]>;
  _gt?: InputMaybe<Scalars["Float"]["input"]>;
  _gte?: InputMaybe<Scalars["Float"]["input"]>;
  _in?: InputMaybe<Array<Scalars["Float"]["input"]>>;
  _is_null?: InputMaybe<Scalars["Boolean"]["input"]>;
  _lt?: InputMaybe<Scalars["Float"]["input"]>;
  _lte?: InputMaybe<Scalars["Float"]["input"]>;
  _neq?: InputMaybe<Scalars["Float"]["input"]>;
  _nin?: InputMaybe<Array<Scalars["Float"]["input"]>>;
};

/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
export type Int_Comparison_Exp = {
  _eq?: InputMaybe<Scalars["Int"]["input"]>;
  _gt?: InputMaybe<Scalars["Int"]["input"]>;
  _gte?: InputMaybe<Scalars["Int"]["input"]>;
  _in?: InputMaybe<Array<Scalars["Int"]["input"]>>;
  _is_null?: InputMaybe<Scalars["Boolean"]["input"]>;
  _lt?: InputMaybe<Scalars["Int"]["input"]>;
  _lte?: InputMaybe<Scalars["Int"]["input"]>;
  _neq?: InputMaybe<Scalars["Int"]["input"]>;
  _nin?: InputMaybe<Array<Scalars["Int"]["input"]>>;
};

/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
export type String_Comparison_Exp = {
  _eq?: InputMaybe<Scalars["String"]["input"]>;
  _gt?: InputMaybe<Scalars["String"]["input"]>;
  _gte?: InputMaybe<Scalars["String"]["input"]>;
  /** does the column match the given case-insensitive pattern */
  _ilike?: InputMaybe<Scalars["String"]["input"]>;
  _in?: InputMaybe<Array<Scalars["String"]["input"]>>;
  /** does the column match the given POSIX regular expression, case insensitive */
  _iregex?: InputMaybe<Scalars["String"]["input"]>;
  _is_null?: InputMaybe<Scalars["Boolean"]["input"]>;
  /** does the column match the given pattern */
  _like?: InputMaybe<Scalars["String"]["input"]>;
  _lt?: InputMaybe<Scalars["String"]["input"]>;
  _lte?: InputMaybe<Scalars["String"]["input"]>;
  _neq?: InputMaybe<Scalars["String"]["input"]>;
  /** does the column NOT match the given case-insensitive pattern */
  _nilike?: InputMaybe<Scalars["String"]["input"]>;
  _nin?: InputMaybe<Array<Scalars["String"]["input"]>>;
  /** does the column NOT match the given POSIX regular expression, case insensitive */
  _niregex?: InputMaybe<Scalars["String"]["input"]>;
  /** does the column NOT match the given pattern */
  _nlike?: InputMaybe<Scalars["String"]["input"]>;
  /** does the column NOT match the given POSIX regular expression, case sensitive */
  _nregex?: InputMaybe<Scalars["String"]["input"]>;
  /** does the column NOT match the given SQL regular expression */
  _nsimilar?: InputMaybe<Scalars["String"]["input"]>;
  /** does the column match the given POSIX regular expression, case sensitive */
  _regex?: InputMaybe<Scalars["String"]["input"]>;
  /** does the column match the given SQL regular expression */
  _similar?: InputMaybe<Scalars["String"]["input"]>;
};

/** ordering argument of a cursor */
export enum Cursor_Ordering {
  /** ascending ordering of the cursor */
  Asc = "ASC",
  /** descending ordering of the cursor */
  Desc = "DESC",
}

/** mutation root */
export type Mutation_Root = {
  __typename?: "mutation_root";
  /** delete data from the table: "radio.listener_snapshots" */
  delete_radio_listener_snapshots?: Maybe<Radio_Listener_Snapshots_Mutation_Response>;
  /** delete single row from the table: "radio.listener_snapshots" */
  delete_radio_listener_snapshots_by_pk?: Maybe<Radio_Listener_Snapshots>;
  /** delete data from the table: "radio.play_history" */
  delete_radio_play_history?: Maybe<Radio_Play_History_Mutation_Response>;
  /** delete single row from the table: "radio.play_history" */
  delete_radio_play_history_by_pk?: Maybe<Radio_Play_History>;
  /** delete data from the table: "radio.skip_requests" */
  delete_radio_skip_requests?: Maybe<Radio_Skip_Requests_Mutation_Response>;
  /** delete single row from the table: "radio.skip_requests" */
  delete_radio_skip_requests_by_pk?: Maybe<Radio_Skip_Requests>;
  /** delete data from the table: "radio.tracks" */
  delete_radio_tracks?: Maybe<Radio_Tracks_Mutation_Response>;
  /** delete single row from the table: "radio.tracks" */
  delete_radio_tracks_by_pk?: Maybe<Radio_Tracks>;
  /** insert data into the table: "radio.listener_snapshots" */
  insert_radio_listener_snapshots?: Maybe<Radio_Listener_Snapshots_Mutation_Response>;
  /** insert a single row into the table: "radio.listener_snapshots" */
  insert_radio_listener_snapshots_one?: Maybe<Radio_Listener_Snapshots>;
  /** insert data into the table: "radio.play_history" */
  insert_radio_play_history?: Maybe<Radio_Play_History_Mutation_Response>;
  /** insert a single row into the table: "radio.play_history" */
  insert_radio_play_history_one?: Maybe<Radio_Play_History>;
  /** insert data into the table: "radio.skip_requests" */
  insert_radio_skip_requests?: Maybe<Radio_Skip_Requests_Mutation_Response>;
  /** insert a single row into the table: "radio.skip_requests" */
  insert_radio_skip_requests_one?: Maybe<Radio_Skip_Requests>;
  /** insert data into the table: "radio.tracks" */
  insert_radio_tracks?: Maybe<Radio_Tracks_Mutation_Response>;
  /** insert a single row into the table: "radio.tracks" */
  insert_radio_tracks_one?: Maybe<Radio_Tracks>;
  /** update data of the table: "radio.listener_snapshots" */
  update_radio_listener_snapshots?: Maybe<Radio_Listener_Snapshots_Mutation_Response>;
  /** update single row of the table: "radio.listener_snapshots" */
  update_radio_listener_snapshots_by_pk?: Maybe<Radio_Listener_Snapshots>;
  /** update multiples rows of table: "radio.listener_snapshots" */
  update_radio_listener_snapshots_many?: Maybe<
    Array<Maybe<Radio_Listener_Snapshots_Mutation_Response>>
  >;
  /** update data of the table: "radio.play_history" */
  update_radio_play_history?: Maybe<Radio_Play_History_Mutation_Response>;
  /** update single row of the table: "radio.play_history" */
  update_radio_play_history_by_pk?: Maybe<Radio_Play_History>;
  /** update multiples rows of table: "radio.play_history" */
  update_radio_play_history_many?: Maybe<
    Array<Maybe<Radio_Play_History_Mutation_Response>>
  >;
  /** update data of the table: "radio.skip_requests" */
  update_radio_skip_requests?: Maybe<Radio_Skip_Requests_Mutation_Response>;
  /** update single row of the table: "radio.skip_requests" */
  update_radio_skip_requests_by_pk?: Maybe<Radio_Skip_Requests>;
  /** update multiples rows of table: "radio.skip_requests" */
  update_radio_skip_requests_many?: Maybe<
    Array<Maybe<Radio_Skip_Requests_Mutation_Response>>
  >;
  /** update data of the table: "radio.tracks" */
  update_radio_tracks?: Maybe<Radio_Tracks_Mutation_Response>;
  /** update single row of the table: "radio.tracks" */
  update_radio_tracks_by_pk?: Maybe<Radio_Tracks>;
  /** update multiples rows of table: "radio.tracks" */
  update_radio_tracks_many?: Maybe<
    Array<Maybe<Radio_Tracks_Mutation_Response>>
  >;
};

/** mutation root */
export type Mutation_RootDelete_Radio_Listener_SnapshotsArgs = {
  where: Radio_Listener_Snapshots_Bool_Exp;
};

/** mutation root */
export type Mutation_RootDelete_Radio_Listener_Snapshots_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

/** mutation root */
export type Mutation_RootDelete_Radio_Play_HistoryArgs = {
  where: Radio_Play_History_Bool_Exp;
};

/** mutation root */
export type Mutation_RootDelete_Radio_Play_History_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

/** mutation root */
export type Mutation_RootDelete_Radio_Skip_RequestsArgs = {
  where: Radio_Skip_Requests_Bool_Exp;
};

/** mutation root */
export type Mutation_RootDelete_Radio_Skip_Requests_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

/** mutation root */
export type Mutation_RootDelete_Radio_TracksArgs = {
  where: Radio_Tracks_Bool_Exp;
};

/** mutation root */
export type Mutation_RootDelete_Radio_Tracks_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

/** mutation root */
export type Mutation_RootInsert_Radio_Listener_SnapshotsArgs = {
  objects: Array<Radio_Listener_Snapshots_Insert_Input>;
  on_conflict?: InputMaybe<Radio_Listener_Snapshots_On_Conflict>;
};

/** mutation root */
export type Mutation_RootInsert_Radio_Listener_Snapshots_OneArgs = {
  object: Radio_Listener_Snapshots_Insert_Input;
  on_conflict?: InputMaybe<Radio_Listener_Snapshots_On_Conflict>;
};

/** mutation root */
export type Mutation_RootInsert_Radio_Play_HistoryArgs = {
  objects: Array<Radio_Play_History_Insert_Input>;
  on_conflict?: InputMaybe<Radio_Play_History_On_Conflict>;
};

/** mutation root */
export type Mutation_RootInsert_Radio_Play_History_OneArgs = {
  object: Radio_Play_History_Insert_Input;
  on_conflict?: InputMaybe<Radio_Play_History_On_Conflict>;
};

/** mutation root */
export type Mutation_RootInsert_Radio_Skip_RequestsArgs = {
  objects: Array<Radio_Skip_Requests_Insert_Input>;
  on_conflict?: InputMaybe<Radio_Skip_Requests_On_Conflict>;
};

/** mutation root */
export type Mutation_RootInsert_Radio_Skip_Requests_OneArgs = {
  object: Radio_Skip_Requests_Insert_Input;
  on_conflict?: InputMaybe<Radio_Skip_Requests_On_Conflict>;
};

/** mutation root */
export type Mutation_RootInsert_Radio_TracksArgs = {
  objects: Array<Radio_Tracks_Insert_Input>;
  on_conflict?: InputMaybe<Radio_Tracks_On_Conflict>;
};

/** mutation root */
export type Mutation_RootInsert_Radio_Tracks_OneArgs = {
  object: Radio_Tracks_Insert_Input;
  on_conflict?: InputMaybe<Radio_Tracks_On_Conflict>;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Listener_SnapshotsArgs = {
  _inc?: InputMaybe<Radio_Listener_Snapshots_Inc_Input>;
  _set?: InputMaybe<Radio_Listener_Snapshots_Set_Input>;
  where: Radio_Listener_Snapshots_Bool_Exp;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Listener_Snapshots_By_PkArgs = {
  _inc?: InputMaybe<Radio_Listener_Snapshots_Inc_Input>;
  _set?: InputMaybe<Radio_Listener_Snapshots_Set_Input>;
  pk_columns: Radio_Listener_Snapshots_Pk_Columns_Input;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Listener_Snapshots_ManyArgs = {
  updates: Array<Radio_Listener_Snapshots_Updates>;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Play_HistoryArgs = {
  _inc?: InputMaybe<Radio_Play_History_Inc_Input>;
  _set?: InputMaybe<Radio_Play_History_Set_Input>;
  where: Radio_Play_History_Bool_Exp;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Play_History_By_PkArgs = {
  _inc?: InputMaybe<Radio_Play_History_Inc_Input>;
  _set?: InputMaybe<Radio_Play_History_Set_Input>;
  pk_columns: Radio_Play_History_Pk_Columns_Input;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Play_History_ManyArgs = {
  updates: Array<Radio_Play_History_Updates>;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Skip_RequestsArgs = {
  _inc?: InputMaybe<Radio_Skip_Requests_Inc_Input>;
  _set?: InputMaybe<Radio_Skip_Requests_Set_Input>;
  where: Radio_Skip_Requests_Bool_Exp;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Skip_Requests_By_PkArgs = {
  _inc?: InputMaybe<Radio_Skip_Requests_Inc_Input>;
  _set?: InputMaybe<Radio_Skip_Requests_Set_Input>;
  pk_columns: Radio_Skip_Requests_Pk_Columns_Input;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Skip_Requests_ManyArgs = {
  updates: Array<Radio_Skip_Requests_Updates>;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_TracksArgs = {
  _inc?: InputMaybe<Radio_Tracks_Inc_Input>;
  _set?: InputMaybe<Radio_Tracks_Set_Input>;
  where: Radio_Tracks_Bool_Exp;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Tracks_By_PkArgs = {
  _inc?: InputMaybe<Radio_Tracks_Inc_Input>;
  _set?: InputMaybe<Radio_Tracks_Set_Input>;
  pk_columns: Radio_Tracks_Pk_Columns_Input;
};

/** mutation root */
export type Mutation_RootUpdate_Radio_Tracks_ManyArgs = {
  updates: Array<Radio_Tracks_Updates>;
};

/** column ordering options */
export enum Order_By {
  /** in ascending order, nulls last */
  Asc = "asc",
  /** in ascending order, nulls first */
  AscNullsFirst = "asc_nulls_first",
  /** in ascending order, nulls last */
  AscNullsLast = "asc_nulls_last",
  /** in descending order, nulls first */
  Desc = "desc",
  /** in descending order, nulls first */
  DescNullsFirst = "desc_nulls_first",
  /** in descending order, nulls last */
  DescNullsLast = "desc_nulls_last",
}

export type Query_Root = {
  __typename?: "query_root";
  /** fetch data from the table: "radio.listener_snapshots" */
  radio_listener_snapshots: Array<Radio_Listener_Snapshots>;
  /** fetch aggregated fields from the table: "radio.listener_snapshots" */
  radio_listener_snapshots_aggregate: Radio_Listener_Snapshots_Aggregate;
  /** fetch data from the table: "radio.listener_snapshots" using primary key columns */
  radio_listener_snapshots_by_pk?: Maybe<Radio_Listener_Snapshots>;
  /** fetch data from the table: "radio.play_history" */
  radio_play_history: Array<Radio_Play_History>;
  /** fetch aggregated fields from the table: "radio.play_history" */
  radio_play_history_aggregate: Radio_Play_History_Aggregate;
  /** fetch data from the table: "radio.play_history" using primary key columns */
  radio_play_history_by_pk?: Maybe<Radio_Play_History>;
  /** fetch data from the table: "radio.skip_requests" */
  radio_skip_requests: Array<Radio_Skip_Requests>;
  /** fetch aggregated fields from the table: "radio.skip_requests" */
  radio_skip_requests_aggregate: Radio_Skip_Requests_Aggregate;
  /** fetch data from the table: "radio.skip_requests" using primary key columns */
  radio_skip_requests_by_pk?: Maybe<Radio_Skip_Requests>;
  /** fetch data from the table: "radio.tracks" */
  radio_tracks: Array<Radio_Tracks>;
  /** fetch aggregated fields from the table: "radio.tracks" */
  radio_tracks_aggregate: Radio_Tracks_Aggregate;
  /** fetch data from the table: "radio.tracks" using primary key columns */
  radio_tracks_by_pk?: Maybe<Radio_Tracks>;
};

export type Query_RootRadio_Listener_SnapshotsArgs = {
  distinct_on?: InputMaybe<Array<Radio_Listener_Snapshots_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Listener_Snapshots_Order_By>>;
  where?: InputMaybe<Radio_Listener_Snapshots_Bool_Exp>;
};

export type Query_RootRadio_Listener_Snapshots_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Listener_Snapshots_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Listener_Snapshots_Order_By>>;
  where?: InputMaybe<Radio_Listener_Snapshots_Bool_Exp>;
};

export type Query_RootRadio_Listener_Snapshots_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

export type Query_RootRadio_Play_HistoryArgs = {
  distinct_on?: InputMaybe<Array<Radio_Play_History_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Play_History_Order_By>>;
  where?: InputMaybe<Radio_Play_History_Bool_Exp>;
};

export type Query_RootRadio_Play_History_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Play_History_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Play_History_Order_By>>;
  where?: InputMaybe<Radio_Play_History_Bool_Exp>;
};

export type Query_RootRadio_Play_History_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

export type Query_RootRadio_Skip_RequestsArgs = {
  distinct_on?: InputMaybe<Array<Radio_Skip_Requests_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Skip_Requests_Order_By>>;
  where?: InputMaybe<Radio_Skip_Requests_Bool_Exp>;
};

export type Query_RootRadio_Skip_Requests_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Skip_Requests_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Skip_Requests_Order_By>>;
  where?: InputMaybe<Radio_Skip_Requests_Bool_Exp>;
};

export type Query_RootRadio_Skip_Requests_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

export type Query_RootRadio_TracksArgs = {
  distinct_on?: InputMaybe<Array<Radio_Tracks_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Tracks_Order_By>>;
  where?: InputMaybe<Radio_Tracks_Bool_Exp>;
};

export type Query_RootRadio_Tracks_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Tracks_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Tracks_Order_By>>;
  where?: InputMaybe<Radio_Tracks_Bool_Exp>;
};

export type Query_RootRadio_Tracks_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

/** columns and relationships of "radio.listener_snapshots" */
export type Radio_Listener_Snapshots = {
  __typename?: "radio_listener_snapshots";
  count: Scalars["Int"]["output"];
  id: Scalars["Int"]["output"];
  peak: Scalars["Int"]["output"];
  recorded_at?: Maybe<Scalars["timestamptz"]["output"]>;
};

/** aggregated selection of "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_Aggregate = {
  __typename?: "radio_listener_snapshots_aggregate";
  aggregate?: Maybe<Radio_Listener_Snapshots_Aggregate_Fields>;
  nodes: Array<Radio_Listener_Snapshots>;
};

/** aggregate fields of "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_Aggregate_Fields = {
  __typename?: "radio_listener_snapshots_aggregate_fields";
  avg?: Maybe<Radio_Listener_Snapshots_Avg_Fields>;
  count: Scalars["Int"]["output"];
  max?: Maybe<Radio_Listener_Snapshots_Max_Fields>;
  min?: Maybe<Radio_Listener_Snapshots_Min_Fields>;
  stddev?: Maybe<Radio_Listener_Snapshots_Stddev_Fields>;
  stddev_pop?: Maybe<Radio_Listener_Snapshots_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Radio_Listener_Snapshots_Stddev_Samp_Fields>;
  sum?: Maybe<Radio_Listener_Snapshots_Sum_Fields>;
  var_pop?: Maybe<Radio_Listener_Snapshots_Var_Pop_Fields>;
  var_samp?: Maybe<Radio_Listener_Snapshots_Var_Samp_Fields>;
  variance?: Maybe<Radio_Listener_Snapshots_Variance_Fields>;
};

/** aggregate fields of "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Radio_Listener_Snapshots_Select_Column>>;
  distinct?: InputMaybe<Scalars["Boolean"]["input"]>;
};

/** aggregate avg on columns */
export type Radio_Listener_Snapshots_Avg_Fields = {
  __typename?: "radio_listener_snapshots_avg_fields";
  count?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  peak?: Maybe<Scalars["Float"]["output"]>;
};

/** Boolean expression to filter rows from the table "radio.listener_snapshots". All fields are combined with a logical 'AND'. */
export type Radio_Listener_Snapshots_Bool_Exp = {
  _and?: InputMaybe<Array<Radio_Listener_Snapshots_Bool_Exp>>;
  _not?: InputMaybe<Radio_Listener_Snapshots_Bool_Exp>;
  _or?: InputMaybe<Array<Radio_Listener_Snapshots_Bool_Exp>>;
  count?: InputMaybe<Int_Comparison_Exp>;
  id?: InputMaybe<Int_Comparison_Exp>;
  peak?: InputMaybe<Int_Comparison_Exp>;
  recorded_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "radio.listener_snapshots" */
export enum Radio_Listener_Snapshots_Constraint {
  /** unique or primary key constraint on columns "id" */
  ListenerSnapshotsPkey = "listener_snapshots_pkey",
}

/** input type for incrementing numeric columns in table "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_Inc_Input = {
  count?: InputMaybe<Scalars["Int"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  peak?: InputMaybe<Scalars["Int"]["input"]>;
};

/** input type for inserting data into table "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_Insert_Input = {
  count?: InputMaybe<Scalars["Int"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  peak?: InputMaybe<Scalars["Int"]["input"]>;
  recorded_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
};

/** aggregate max on columns */
export type Radio_Listener_Snapshots_Max_Fields = {
  __typename?: "radio_listener_snapshots_max_fields";
  count?: Maybe<Scalars["Int"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  peak?: Maybe<Scalars["Int"]["output"]>;
  recorded_at?: Maybe<Scalars["timestamptz"]["output"]>;
};

/** aggregate min on columns */
export type Radio_Listener_Snapshots_Min_Fields = {
  __typename?: "radio_listener_snapshots_min_fields";
  count?: Maybe<Scalars["Int"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  peak?: Maybe<Scalars["Int"]["output"]>;
  recorded_at?: Maybe<Scalars["timestamptz"]["output"]>;
};

/** response of any mutation on the table "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_Mutation_Response = {
  __typename?: "radio_listener_snapshots_mutation_response";
  /** number of rows affected by the mutation */
  affected_rows: Scalars["Int"]["output"];
  /** data from the rows affected by the mutation */
  returning: Array<Radio_Listener_Snapshots>;
};

/** on_conflict condition type for table "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_On_Conflict = {
  constraint: Radio_Listener_Snapshots_Constraint;
  update_columns?: Array<Radio_Listener_Snapshots_Update_Column>;
  where?: InputMaybe<Radio_Listener_Snapshots_Bool_Exp>;
};

/** Ordering options when selecting data from "radio.listener_snapshots". */
export type Radio_Listener_Snapshots_Order_By = {
  count?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  peak?: InputMaybe<Order_By>;
  recorded_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: radio.listener_snapshots */
export type Radio_Listener_Snapshots_Pk_Columns_Input = {
  id: Scalars["Int"]["input"];
};

/** select columns of table "radio.listener_snapshots" */
export enum Radio_Listener_Snapshots_Select_Column {
  /** column name */
  Count = "count",
  /** column name */
  Id = "id",
  /** column name */
  Peak = "peak",
  /** column name */
  RecordedAt = "recorded_at",
}

/** input type for updating data in table "radio.listener_snapshots" */
export type Radio_Listener_Snapshots_Set_Input = {
  count?: InputMaybe<Scalars["Int"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  peak?: InputMaybe<Scalars["Int"]["input"]>;
  recorded_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
};

/** aggregate stddev on columns */
export type Radio_Listener_Snapshots_Stddev_Fields = {
  __typename?: "radio_listener_snapshots_stddev_fields";
  count?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  peak?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_pop on columns */
export type Radio_Listener_Snapshots_Stddev_Pop_Fields = {
  __typename?: "radio_listener_snapshots_stddev_pop_fields";
  count?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  peak?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_samp on columns */
export type Radio_Listener_Snapshots_Stddev_Samp_Fields = {
  __typename?: "radio_listener_snapshots_stddev_samp_fields";
  count?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  peak?: Maybe<Scalars["Float"]["output"]>;
};

/** Streaming cursor of the table "radio_listener_snapshots" */
export type Radio_Listener_Snapshots_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Radio_Listener_Snapshots_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Radio_Listener_Snapshots_Stream_Cursor_Value_Input = {
  count?: InputMaybe<Scalars["Int"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  peak?: InputMaybe<Scalars["Int"]["input"]>;
  recorded_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
};

/** aggregate sum on columns */
export type Radio_Listener_Snapshots_Sum_Fields = {
  __typename?: "radio_listener_snapshots_sum_fields";
  count?: Maybe<Scalars["Int"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  peak?: Maybe<Scalars["Int"]["output"]>;
};

/** update columns of table "radio.listener_snapshots" */
export enum Radio_Listener_Snapshots_Update_Column {
  /** column name */
  Count = "count",
  /** column name */
  Id = "id",
  /** column name */
  Peak = "peak",
  /** column name */
  RecordedAt = "recorded_at",
}

export type Radio_Listener_Snapshots_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Radio_Listener_Snapshots_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Radio_Listener_Snapshots_Set_Input>;
  /** filter the rows which have to be updated */
  where: Radio_Listener_Snapshots_Bool_Exp;
};

/** aggregate var_pop on columns */
export type Radio_Listener_Snapshots_Var_Pop_Fields = {
  __typename?: "radio_listener_snapshots_var_pop_fields";
  count?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  peak?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate var_samp on columns */
export type Radio_Listener_Snapshots_Var_Samp_Fields = {
  __typename?: "radio_listener_snapshots_var_samp_fields";
  count?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  peak?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate variance on columns */
export type Radio_Listener_Snapshots_Variance_Fields = {
  __typename?: "radio_listener_snapshots_variance_fields";
  count?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  peak?: Maybe<Scalars["Float"]["output"]>;
};

/** columns and relationships of "radio.play_history" */
export type Radio_Play_History = {
  __typename?: "radio_play_history";
  artist: Scalars["String"]["output"];
  dj?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["Int"]["output"];
  played_at?: Maybe<Scalars["timestamptz"]["output"]>;
  title: Scalars["String"]["output"];
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** aggregated selection of "radio.play_history" */
export type Radio_Play_History_Aggregate = {
  __typename?: "radio_play_history_aggregate";
  aggregate?: Maybe<Radio_Play_History_Aggregate_Fields>;
  nodes: Array<Radio_Play_History>;
};

/** aggregate fields of "radio.play_history" */
export type Radio_Play_History_Aggregate_Fields = {
  __typename?: "radio_play_history_aggregate_fields";
  avg?: Maybe<Radio_Play_History_Avg_Fields>;
  count: Scalars["Int"]["output"];
  max?: Maybe<Radio_Play_History_Max_Fields>;
  min?: Maybe<Radio_Play_History_Min_Fields>;
  stddev?: Maybe<Radio_Play_History_Stddev_Fields>;
  stddev_pop?: Maybe<Radio_Play_History_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Radio_Play_History_Stddev_Samp_Fields>;
  sum?: Maybe<Radio_Play_History_Sum_Fields>;
  var_pop?: Maybe<Radio_Play_History_Var_Pop_Fields>;
  var_samp?: Maybe<Radio_Play_History_Var_Samp_Fields>;
  variance?: Maybe<Radio_Play_History_Variance_Fields>;
};

/** aggregate fields of "radio.play_history" */
export type Radio_Play_History_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Radio_Play_History_Select_Column>>;
  distinct?: InputMaybe<Scalars["Boolean"]["input"]>;
};

/** aggregate avg on columns */
export type Radio_Play_History_Avg_Fields = {
  __typename?: "radio_play_history_avg_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** Boolean expression to filter rows from the table "radio.play_history". All fields are combined with a logical 'AND'. */
export type Radio_Play_History_Bool_Exp = {
  _and?: InputMaybe<Array<Radio_Play_History_Bool_Exp>>;
  _not?: InputMaybe<Radio_Play_History_Bool_Exp>;
  _or?: InputMaybe<Array<Radio_Play_History_Bool_Exp>>;
  artist?: InputMaybe<String_Comparison_Exp>;
  dj?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Int_Comparison_Exp>;
  played_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  title?: InputMaybe<String_Comparison_Exp>;
  track_id?: InputMaybe<Int_Comparison_Exp>;
};

/** unique or primary key constraints on table "radio.play_history" */
export enum Radio_Play_History_Constraint {
  /** unique or primary key constraint on columns "id" */
  PlayHistoryPkey = "play_history_pkey",
}

/** input type for incrementing numeric columns in table "radio.play_history" */
export type Radio_Play_History_Inc_Input = {
  id?: InputMaybe<Scalars["Int"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** input type for inserting data into table "radio.play_history" */
export type Radio_Play_History_Insert_Input = {
  artist?: InputMaybe<Scalars["String"]["input"]>;
  dj?: InputMaybe<Scalars["String"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  played_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** aggregate max on columns */
export type Radio_Play_History_Max_Fields = {
  __typename?: "radio_play_history_max_fields";
  artist?: Maybe<Scalars["String"]["output"]>;
  dj?: Maybe<Scalars["String"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  played_at?: Maybe<Scalars["timestamptz"]["output"]>;
  title?: Maybe<Scalars["String"]["output"]>;
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** aggregate min on columns */
export type Radio_Play_History_Min_Fields = {
  __typename?: "radio_play_history_min_fields";
  artist?: Maybe<Scalars["String"]["output"]>;
  dj?: Maybe<Scalars["String"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  played_at?: Maybe<Scalars["timestamptz"]["output"]>;
  title?: Maybe<Scalars["String"]["output"]>;
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** response of any mutation on the table "radio.play_history" */
export type Radio_Play_History_Mutation_Response = {
  __typename?: "radio_play_history_mutation_response";
  /** number of rows affected by the mutation */
  affected_rows: Scalars["Int"]["output"];
  /** data from the rows affected by the mutation */
  returning: Array<Radio_Play_History>;
};

/** on_conflict condition type for table "radio.play_history" */
export type Radio_Play_History_On_Conflict = {
  constraint: Radio_Play_History_Constraint;
  update_columns?: Array<Radio_Play_History_Update_Column>;
  where?: InputMaybe<Radio_Play_History_Bool_Exp>;
};

/** Ordering options when selecting data from "radio.play_history". */
export type Radio_Play_History_Order_By = {
  artist?: InputMaybe<Order_By>;
  dj?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  played_at?: InputMaybe<Order_By>;
  title?: InputMaybe<Order_By>;
  track_id?: InputMaybe<Order_By>;
};

/** primary key columns input for table: radio.play_history */
export type Radio_Play_History_Pk_Columns_Input = {
  id: Scalars["Int"]["input"];
};

/** select columns of table "radio.play_history" */
export enum Radio_Play_History_Select_Column {
  /** column name */
  Artist = "artist",
  /** column name */
  Dj = "dj",
  /** column name */
  Id = "id",
  /** column name */
  PlayedAt = "played_at",
  /** column name */
  Title = "title",
  /** column name */
  TrackId = "track_id",
}

/** input type for updating data in table "radio.play_history" */
export type Radio_Play_History_Set_Input = {
  artist?: InputMaybe<Scalars["String"]["input"]>;
  dj?: InputMaybe<Scalars["String"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  played_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** aggregate stddev on columns */
export type Radio_Play_History_Stddev_Fields = {
  __typename?: "radio_play_history_stddev_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_pop on columns */
export type Radio_Play_History_Stddev_Pop_Fields = {
  __typename?: "radio_play_history_stddev_pop_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_samp on columns */
export type Radio_Play_History_Stddev_Samp_Fields = {
  __typename?: "radio_play_history_stddev_samp_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** Streaming cursor of the table "radio_play_history" */
export type Radio_Play_History_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Radio_Play_History_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Radio_Play_History_Stream_Cursor_Value_Input = {
  artist?: InputMaybe<Scalars["String"]["input"]>;
  dj?: InputMaybe<Scalars["String"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  played_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** aggregate sum on columns */
export type Radio_Play_History_Sum_Fields = {
  __typename?: "radio_play_history_sum_fields";
  id?: Maybe<Scalars["Int"]["output"]>;
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** update columns of table "radio.play_history" */
export enum Radio_Play_History_Update_Column {
  /** column name */
  Artist = "artist",
  /** column name */
  Dj = "dj",
  /** column name */
  Id = "id",
  /** column name */
  PlayedAt = "played_at",
  /** column name */
  Title = "title",
  /** column name */
  TrackId = "track_id",
}

export type Radio_Play_History_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Radio_Play_History_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Radio_Play_History_Set_Input>;
  /** filter the rows which have to be updated */
  where: Radio_Play_History_Bool_Exp;
};

/** aggregate var_pop on columns */
export type Radio_Play_History_Var_Pop_Fields = {
  __typename?: "radio_play_history_var_pop_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate var_samp on columns */
export type Radio_Play_History_Var_Samp_Fields = {
  __typename?: "radio_play_history_var_samp_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate variance on columns */
export type Radio_Play_History_Variance_Fields = {
  __typename?: "radio_play_history_variance_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** columns and relationships of "radio.skip_requests" */
export type Radio_Skip_Requests = {
  __typename?: "radio_skip_requests";
  id: Scalars["Int"]["output"];
  requested_at?: Maybe<Scalars["timestamptz"]["output"]>;
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** aggregated selection of "radio.skip_requests" */
export type Radio_Skip_Requests_Aggregate = {
  __typename?: "radio_skip_requests_aggregate";
  aggregate?: Maybe<Radio_Skip_Requests_Aggregate_Fields>;
  nodes: Array<Radio_Skip_Requests>;
};

/** aggregate fields of "radio.skip_requests" */
export type Radio_Skip_Requests_Aggregate_Fields = {
  __typename?: "radio_skip_requests_aggregate_fields";
  avg?: Maybe<Radio_Skip_Requests_Avg_Fields>;
  count: Scalars["Int"]["output"];
  max?: Maybe<Radio_Skip_Requests_Max_Fields>;
  min?: Maybe<Radio_Skip_Requests_Min_Fields>;
  stddev?: Maybe<Radio_Skip_Requests_Stddev_Fields>;
  stddev_pop?: Maybe<Radio_Skip_Requests_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Radio_Skip_Requests_Stddev_Samp_Fields>;
  sum?: Maybe<Radio_Skip_Requests_Sum_Fields>;
  var_pop?: Maybe<Radio_Skip_Requests_Var_Pop_Fields>;
  var_samp?: Maybe<Radio_Skip_Requests_Var_Samp_Fields>;
  variance?: Maybe<Radio_Skip_Requests_Variance_Fields>;
};

/** aggregate fields of "radio.skip_requests" */
export type Radio_Skip_Requests_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Radio_Skip_Requests_Select_Column>>;
  distinct?: InputMaybe<Scalars["Boolean"]["input"]>;
};

/** aggregate avg on columns */
export type Radio_Skip_Requests_Avg_Fields = {
  __typename?: "radio_skip_requests_avg_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** Boolean expression to filter rows from the table "radio.skip_requests". All fields are combined with a logical 'AND'. */
export type Radio_Skip_Requests_Bool_Exp = {
  _and?: InputMaybe<Array<Radio_Skip_Requests_Bool_Exp>>;
  _not?: InputMaybe<Radio_Skip_Requests_Bool_Exp>;
  _or?: InputMaybe<Array<Radio_Skip_Requests_Bool_Exp>>;
  id?: InputMaybe<Int_Comparison_Exp>;
  requested_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  track_id?: InputMaybe<Int_Comparison_Exp>;
};

/** unique or primary key constraints on table "radio.skip_requests" */
export enum Radio_Skip_Requests_Constraint {
  /** unique or primary key constraint on columns "id" */
  SkipRequestsPkey = "skip_requests_pkey",
}

/** input type for incrementing numeric columns in table "radio.skip_requests" */
export type Radio_Skip_Requests_Inc_Input = {
  id?: InputMaybe<Scalars["Int"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** input type for inserting data into table "radio.skip_requests" */
export type Radio_Skip_Requests_Insert_Input = {
  id?: InputMaybe<Scalars["Int"]["input"]>;
  requested_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** aggregate max on columns */
export type Radio_Skip_Requests_Max_Fields = {
  __typename?: "radio_skip_requests_max_fields";
  id?: Maybe<Scalars["Int"]["output"]>;
  requested_at?: Maybe<Scalars["timestamptz"]["output"]>;
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** aggregate min on columns */
export type Radio_Skip_Requests_Min_Fields = {
  __typename?: "radio_skip_requests_min_fields";
  id?: Maybe<Scalars["Int"]["output"]>;
  requested_at?: Maybe<Scalars["timestamptz"]["output"]>;
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** response of any mutation on the table "radio.skip_requests" */
export type Radio_Skip_Requests_Mutation_Response = {
  __typename?: "radio_skip_requests_mutation_response";
  /** number of rows affected by the mutation */
  affected_rows: Scalars["Int"]["output"];
  /** data from the rows affected by the mutation */
  returning: Array<Radio_Skip_Requests>;
};

/** on_conflict condition type for table "radio.skip_requests" */
export type Radio_Skip_Requests_On_Conflict = {
  constraint: Radio_Skip_Requests_Constraint;
  update_columns?: Array<Radio_Skip_Requests_Update_Column>;
  where?: InputMaybe<Radio_Skip_Requests_Bool_Exp>;
};

/** Ordering options when selecting data from "radio.skip_requests". */
export type Radio_Skip_Requests_Order_By = {
  id?: InputMaybe<Order_By>;
  requested_at?: InputMaybe<Order_By>;
  track_id?: InputMaybe<Order_By>;
};

/** primary key columns input for table: radio.skip_requests */
export type Radio_Skip_Requests_Pk_Columns_Input = {
  id: Scalars["Int"]["input"];
};

/** select columns of table "radio.skip_requests" */
export enum Radio_Skip_Requests_Select_Column {
  /** column name */
  Id = "id",
  /** column name */
  RequestedAt = "requested_at",
  /** column name */
  TrackId = "track_id",
}

/** input type for updating data in table "radio.skip_requests" */
export type Radio_Skip_Requests_Set_Input = {
  id?: InputMaybe<Scalars["Int"]["input"]>;
  requested_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** aggregate stddev on columns */
export type Radio_Skip_Requests_Stddev_Fields = {
  __typename?: "radio_skip_requests_stddev_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_pop on columns */
export type Radio_Skip_Requests_Stddev_Pop_Fields = {
  __typename?: "radio_skip_requests_stddev_pop_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_samp on columns */
export type Radio_Skip_Requests_Stddev_Samp_Fields = {
  __typename?: "radio_skip_requests_stddev_samp_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** Streaming cursor of the table "radio_skip_requests" */
export type Radio_Skip_Requests_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Radio_Skip_Requests_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Radio_Skip_Requests_Stream_Cursor_Value_Input = {
  id?: InputMaybe<Scalars["Int"]["input"]>;
  requested_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
};

/** aggregate sum on columns */
export type Radio_Skip_Requests_Sum_Fields = {
  __typename?: "radio_skip_requests_sum_fields";
  id?: Maybe<Scalars["Int"]["output"]>;
  track_id?: Maybe<Scalars["Int"]["output"]>;
};

/** update columns of table "radio.skip_requests" */
export enum Radio_Skip_Requests_Update_Column {
  /** column name */
  Id = "id",
  /** column name */
  RequestedAt = "requested_at",
  /** column name */
  TrackId = "track_id",
}

export type Radio_Skip_Requests_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Radio_Skip_Requests_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Radio_Skip_Requests_Set_Input>;
  /** filter the rows which have to be updated */
  where: Radio_Skip_Requests_Bool_Exp;
};

/** aggregate var_pop on columns */
export type Radio_Skip_Requests_Var_Pop_Fields = {
  __typename?: "radio_skip_requests_var_pop_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate var_samp on columns */
export type Radio_Skip_Requests_Var_Samp_Fields = {
  __typename?: "radio_skip_requests_var_samp_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate variance on columns */
export type Radio_Skip_Requests_Variance_Fields = {
  __typename?: "radio_skip_requests_variance_fields";
  id?: Maybe<Scalars["Float"]["output"]>;
  track_id?: Maybe<Scalars["Float"]["output"]>;
};

/** columns and relationships of "radio.tracks" */
export type Radio_Tracks = {
  __typename?: "radio_tracks";
  album?: Maybe<Scalars["String"]["output"]>;
  artist?: Maybe<Scalars["String"]["output"]>;
  bpm?: Maybe<Scalars["Float"]["output"]>;
  created_at?: Maybe<Scalars["timestamptz"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  genre?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["Int"]["output"];
  path: Scalars["String"]["output"];
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
  title?: Maybe<Scalars["String"]["output"]>;
  updated_at?: Maybe<Scalars["timestamptz"]["output"]>;
};

/** aggregated selection of "radio.tracks" */
export type Radio_Tracks_Aggregate = {
  __typename?: "radio_tracks_aggregate";
  aggregate?: Maybe<Radio_Tracks_Aggregate_Fields>;
  nodes: Array<Radio_Tracks>;
};

/** aggregate fields of "radio.tracks" */
export type Radio_Tracks_Aggregate_Fields = {
  __typename?: "radio_tracks_aggregate_fields";
  avg?: Maybe<Radio_Tracks_Avg_Fields>;
  count: Scalars["Int"]["output"];
  max?: Maybe<Radio_Tracks_Max_Fields>;
  min?: Maybe<Radio_Tracks_Min_Fields>;
  stddev?: Maybe<Radio_Tracks_Stddev_Fields>;
  stddev_pop?: Maybe<Radio_Tracks_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Radio_Tracks_Stddev_Samp_Fields>;
  sum?: Maybe<Radio_Tracks_Sum_Fields>;
  var_pop?: Maybe<Radio_Tracks_Var_Pop_Fields>;
  var_samp?: Maybe<Radio_Tracks_Var_Samp_Fields>;
  variance?: Maybe<Radio_Tracks_Variance_Fields>;
};

/** aggregate fields of "radio.tracks" */
export type Radio_Tracks_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Radio_Tracks_Select_Column>>;
  distinct?: InputMaybe<Scalars["Boolean"]["input"]>;
};

/** aggregate avg on columns */
export type Radio_Tracks_Avg_Fields = {
  __typename?: "radio_tracks_avg_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

/** Boolean expression to filter rows from the table "radio.tracks". All fields are combined with a logical 'AND'. */
export type Radio_Tracks_Bool_Exp = {
  _and?: InputMaybe<Array<Radio_Tracks_Bool_Exp>>;
  _not?: InputMaybe<Radio_Tracks_Bool_Exp>;
  _or?: InputMaybe<Array<Radio_Tracks_Bool_Exp>>;
  album?: InputMaybe<String_Comparison_Exp>;
  artist?: InputMaybe<String_Comparison_Exp>;
  bpm?: InputMaybe<Float_Comparison_Exp>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  duration_secs?: InputMaybe<Float_Comparison_Exp>;
  energy?: InputMaybe<Float_Comparison_Exp>;
  genre?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Int_Comparison_Exp>;
  path?: InputMaybe<String_Comparison_Exp>;
  replaygain_db?: InputMaybe<Float_Comparison_Exp>;
  title?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "radio.tracks" */
export enum Radio_Tracks_Constraint {
  /** unique or primary key constraint on columns "path" */
  TracksPathKey = "tracks_path_key",
  /** unique or primary key constraint on columns "id" */
  TracksPkey = "tracks_pkey",
}

/** input type for incrementing numeric columns in table "radio.tracks" */
export type Radio_Tracks_Inc_Input = {
  bpm?: InputMaybe<Scalars["Float"]["input"]>;
  duration_secs?: InputMaybe<Scalars["Float"]["input"]>;
  energy?: InputMaybe<Scalars["Float"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  replaygain_db?: InputMaybe<Scalars["Float"]["input"]>;
};

/** input type for inserting data into table "radio.tracks" */
export type Radio_Tracks_Insert_Input = {
  album?: InputMaybe<Scalars["String"]["input"]>;
  artist?: InputMaybe<Scalars["String"]["input"]>;
  bpm?: InputMaybe<Scalars["Float"]["input"]>;
  created_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  duration_secs?: InputMaybe<Scalars["Float"]["input"]>;
  energy?: InputMaybe<Scalars["Float"]["input"]>;
  genre?: InputMaybe<Scalars["String"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  path?: InputMaybe<Scalars["String"]["input"]>;
  replaygain_db?: InputMaybe<Scalars["Float"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  updated_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
};

/** aggregate max on columns */
export type Radio_Tracks_Max_Fields = {
  __typename?: "radio_tracks_max_fields";
  album?: Maybe<Scalars["String"]["output"]>;
  artist?: Maybe<Scalars["String"]["output"]>;
  bpm?: Maybe<Scalars["Float"]["output"]>;
  created_at?: Maybe<Scalars["timestamptz"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  genre?: Maybe<Scalars["String"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  path?: Maybe<Scalars["String"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
  title?: Maybe<Scalars["String"]["output"]>;
  updated_at?: Maybe<Scalars["timestamptz"]["output"]>;
};

/** aggregate min on columns */
export type Radio_Tracks_Min_Fields = {
  __typename?: "radio_tracks_min_fields";
  album?: Maybe<Scalars["String"]["output"]>;
  artist?: Maybe<Scalars["String"]["output"]>;
  bpm?: Maybe<Scalars["Float"]["output"]>;
  created_at?: Maybe<Scalars["timestamptz"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  genre?: Maybe<Scalars["String"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  path?: Maybe<Scalars["String"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
  title?: Maybe<Scalars["String"]["output"]>;
  updated_at?: Maybe<Scalars["timestamptz"]["output"]>;
};

/** response of any mutation on the table "radio.tracks" */
export type Radio_Tracks_Mutation_Response = {
  __typename?: "radio_tracks_mutation_response";
  /** number of rows affected by the mutation */
  affected_rows: Scalars["Int"]["output"];
  /** data from the rows affected by the mutation */
  returning: Array<Radio_Tracks>;
};

/** on_conflict condition type for table "radio.tracks" */
export type Radio_Tracks_On_Conflict = {
  constraint: Radio_Tracks_Constraint;
  update_columns?: Array<Radio_Tracks_Update_Column>;
  where?: InputMaybe<Radio_Tracks_Bool_Exp>;
};

/** Ordering options when selecting data from "radio.tracks". */
export type Radio_Tracks_Order_By = {
  album?: InputMaybe<Order_By>;
  artist?: InputMaybe<Order_By>;
  bpm?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  duration_secs?: InputMaybe<Order_By>;
  energy?: InputMaybe<Order_By>;
  genre?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  path?: InputMaybe<Order_By>;
  replaygain_db?: InputMaybe<Order_By>;
  title?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: radio.tracks */
export type Radio_Tracks_Pk_Columns_Input = {
  id: Scalars["Int"]["input"];
};

/** select columns of table "radio.tracks" */
export enum Radio_Tracks_Select_Column {
  /** column name */
  Album = "album",
  /** column name */
  Artist = "artist",
  /** column name */
  Bpm = "bpm",
  /** column name */
  CreatedAt = "created_at",
  /** column name */
  DurationSecs = "duration_secs",
  /** column name */
  Energy = "energy",
  /** column name */
  Genre = "genre",
  /** column name */
  Id = "id",
  /** column name */
  Path = "path",
  /** column name */
  ReplaygainDb = "replaygain_db",
  /** column name */
  Title = "title",
  /** column name */
  UpdatedAt = "updated_at",
}

/** input type for updating data in table "radio.tracks" */
export type Radio_Tracks_Set_Input = {
  album?: InputMaybe<Scalars["String"]["input"]>;
  artist?: InputMaybe<Scalars["String"]["input"]>;
  bpm?: InputMaybe<Scalars["Float"]["input"]>;
  created_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  duration_secs?: InputMaybe<Scalars["Float"]["input"]>;
  energy?: InputMaybe<Scalars["Float"]["input"]>;
  genre?: InputMaybe<Scalars["String"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  path?: InputMaybe<Scalars["String"]["input"]>;
  replaygain_db?: InputMaybe<Scalars["Float"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  updated_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
};

/** aggregate stddev on columns */
export type Radio_Tracks_Stddev_Fields = {
  __typename?: "radio_tracks_stddev_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_pop on columns */
export type Radio_Tracks_Stddev_Pop_Fields = {
  __typename?: "radio_tracks_stddev_pop_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate stddev_samp on columns */
export type Radio_Tracks_Stddev_Samp_Fields = {
  __typename?: "radio_tracks_stddev_samp_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

/** Streaming cursor of the table "radio_tracks" */
export type Radio_Tracks_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Radio_Tracks_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Radio_Tracks_Stream_Cursor_Value_Input = {
  album?: InputMaybe<Scalars["String"]["input"]>;
  artist?: InputMaybe<Scalars["String"]["input"]>;
  bpm?: InputMaybe<Scalars["Float"]["input"]>;
  created_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
  duration_secs?: InputMaybe<Scalars["Float"]["input"]>;
  energy?: InputMaybe<Scalars["Float"]["input"]>;
  genre?: InputMaybe<Scalars["String"]["input"]>;
  id?: InputMaybe<Scalars["Int"]["input"]>;
  path?: InputMaybe<Scalars["String"]["input"]>;
  replaygain_db?: InputMaybe<Scalars["Float"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  updated_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
};

/** aggregate sum on columns */
export type Radio_Tracks_Sum_Fields = {
  __typename?: "radio_tracks_sum_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Int"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

/** update columns of table "radio.tracks" */
export enum Radio_Tracks_Update_Column {
  /** column name */
  Album = "album",
  /** column name */
  Artist = "artist",
  /** column name */
  Bpm = "bpm",
  /** column name */
  CreatedAt = "created_at",
  /** column name */
  DurationSecs = "duration_secs",
  /** column name */
  Energy = "energy",
  /** column name */
  Genre = "genre",
  /** column name */
  Id = "id",
  /** column name */
  Path = "path",
  /** column name */
  ReplaygainDb = "replaygain_db",
  /** column name */
  Title = "title",
  /** column name */
  UpdatedAt = "updated_at",
}

export type Radio_Tracks_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Radio_Tracks_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Radio_Tracks_Set_Input>;
  /** filter the rows which have to be updated */
  where: Radio_Tracks_Bool_Exp;
};

/** aggregate var_pop on columns */
export type Radio_Tracks_Var_Pop_Fields = {
  __typename?: "radio_tracks_var_pop_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate var_samp on columns */
export type Radio_Tracks_Var_Samp_Fields = {
  __typename?: "radio_tracks_var_samp_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

/** aggregate variance on columns */
export type Radio_Tracks_Variance_Fields = {
  __typename?: "radio_tracks_variance_fields";
  bpm?: Maybe<Scalars["Float"]["output"]>;
  duration_secs?: Maybe<Scalars["Float"]["output"]>;
  energy?: Maybe<Scalars["Float"]["output"]>;
  id?: Maybe<Scalars["Float"]["output"]>;
  replaygain_db?: Maybe<Scalars["Float"]["output"]>;
};

export type Subscription_Root = {
  __typename?: "subscription_root";
  /** fetch data from the table: "radio.listener_snapshots" */
  radio_listener_snapshots: Array<Radio_Listener_Snapshots>;
  /** fetch aggregated fields from the table: "radio.listener_snapshots" */
  radio_listener_snapshots_aggregate: Radio_Listener_Snapshots_Aggregate;
  /** fetch data from the table: "radio.listener_snapshots" using primary key columns */
  radio_listener_snapshots_by_pk?: Maybe<Radio_Listener_Snapshots>;
  /** fetch data from the table in a streaming manner: "radio.listener_snapshots" */
  radio_listener_snapshots_stream: Array<Radio_Listener_Snapshots>;
  /** fetch data from the table: "radio.play_history" */
  radio_play_history: Array<Radio_Play_History>;
  /** fetch aggregated fields from the table: "radio.play_history" */
  radio_play_history_aggregate: Radio_Play_History_Aggregate;
  /** fetch data from the table: "radio.play_history" using primary key columns */
  radio_play_history_by_pk?: Maybe<Radio_Play_History>;
  /** fetch data from the table in a streaming manner: "radio.play_history" */
  radio_play_history_stream: Array<Radio_Play_History>;
  /** fetch data from the table: "radio.skip_requests" */
  radio_skip_requests: Array<Radio_Skip_Requests>;
  /** fetch aggregated fields from the table: "radio.skip_requests" */
  radio_skip_requests_aggregate: Radio_Skip_Requests_Aggregate;
  /** fetch data from the table: "radio.skip_requests" using primary key columns */
  radio_skip_requests_by_pk?: Maybe<Radio_Skip_Requests>;
  /** fetch data from the table in a streaming manner: "radio.skip_requests" */
  radio_skip_requests_stream: Array<Radio_Skip_Requests>;
  /** fetch data from the table: "radio.tracks" */
  radio_tracks: Array<Radio_Tracks>;
  /** fetch aggregated fields from the table: "radio.tracks" */
  radio_tracks_aggregate: Radio_Tracks_Aggregate;
  /** fetch data from the table: "radio.tracks" using primary key columns */
  radio_tracks_by_pk?: Maybe<Radio_Tracks>;
  /** fetch data from the table in a streaming manner: "radio.tracks" */
  radio_tracks_stream: Array<Radio_Tracks>;
};

export type Subscription_RootRadio_Listener_SnapshotsArgs = {
  distinct_on?: InputMaybe<Array<Radio_Listener_Snapshots_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Listener_Snapshots_Order_By>>;
  where?: InputMaybe<Radio_Listener_Snapshots_Bool_Exp>;
};

export type Subscription_RootRadio_Listener_Snapshots_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Listener_Snapshots_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Listener_Snapshots_Order_By>>;
  where?: InputMaybe<Radio_Listener_Snapshots_Bool_Exp>;
};

export type Subscription_RootRadio_Listener_Snapshots_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

export type Subscription_RootRadio_Listener_Snapshots_StreamArgs = {
  batch_size: Scalars["Int"]["input"];
  cursor: Array<InputMaybe<Radio_Listener_Snapshots_Stream_Cursor_Input>>;
  where?: InputMaybe<Radio_Listener_Snapshots_Bool_Exp>;
};

export type Subscription_RootRadio_Play_HistoryArgs = {
  distinct_on?: InputMaybe<Array<Radio_Play_History_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Play_History_Order_By>>;
  where?: InputMaybe<Radio_Play_History_Bool_Exp>;
};

export type Subscription_RootRadio_Play_History_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Play_History_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Play_History_Order_By>>;
  where?: InputMaybe<Radio_Play_History_Bool_Exp>;
};

export type Subscription_RootRadio_Play_History_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

export type Subscription_RootRadio_Play_History_StreamArgs = {
  batch_size: Scalars["Int"]["input"];
  cursor: Array<InputMaybe<Radio_Play_History_Stream_Cursor_Input>>;
  where?: InputMaybe<Radio_Play_History_Bool_Exp>;
};

export type Subscription_RootRadio_Skip_RequestsArgs = {
  distinct_on?: InputMaybe<Array<Radio_Skip_Requests_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Skip_Requests_Order_By>>;
  where?: InputMaybe<Radio_Skip_Requests_Bool_Exp>;
};

export type Subscription_RootRadio_Skip_Requests_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Skip_Requests_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Skip_Requests_Order_By>>;
  where?: InputMaybe<Radio_Skip_Requests_Bool_Exp>;
};

export type Subscription_RootRadio_Skip_Requests_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

export type Subscription_RootRadio_Skip_Requests_StreamArgs = {
  batch_size: Scalars["Int"]["input"];
  cursor: Array<InputMaybe<Radio_Skip_Requests_Stream_Cursor_Input>>;
  where?: InputMaybe<Radio_Skip_Requests_Bool_Exp>;
};

export type Subscription_RootRadio_TracksArgs = {
  distinct_on?: InputMaybe<Array<Radio_Tracks_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Tracks_Order_By>>;
  where?: InputMaybe<Radio_Tracks_Bool_Exp>;
};

export type Subscription_RootRadio_Tracks_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Radio_Tracks_Select_Column>>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  order_by?: InputMaybe<Array<Radio_Tracks_Order_By>>;
  where?: InputMaybe<Radio_Tracks_Bool_Exp>;
};

export type Subscription_RootRadio_Tracks_By_PkArgs = {
  id: Scalars["Int"]["input"];
};

export type Subscription_RootRadio_Tracks_StreamArgs = {
  batch_size: Scalars["Int"]["input"];
  cursor: Array<InputMaybe<Radio_Tracks_Stream_Cursor_Input>>;
  where?: InputMaybe<Radio_Tracks_Bool_Exp>;
};

/** Boolean expression to compare columns of type "timestamptz". All fields are combined with logical 'AND'. */
export type Timestamptz_Comparison_Exp = {
  _eq?: InputMaybe<Scalars["timestamptz"]["input"]>;
  _gt?: InputMaybe<Scalars["timestamptz"]["input"]>;
  _gte?: InputMaybe<Scalars["timestamptz"]["input"]>;
  _in?: InputMaybe<Array<Scalars["timestamptz"]["input"]>>;
  _is_null?: InputMaybe<Scalars["Boolean"]["input"]>;
  _lt?: InputMaybe<Scalars["timestamptz"]["input"]>;
  _lte?: InputMaybe<Scalars["timestamptz"]["input"]>;
  _neq?: InputMaybe<Scalars["timestamptz"]["input"]>;
  _nin?: InputMaybe<Array<Scalars["timestamptz"]["input"]>>;
};

export type InsertPlayEventMutationVariables = Exact<{
  artist: Scalars["String"]["input"];
  title: Scalars["String"]["input"];
  dj?: InputMaybe<Scalars["String"]["input"]>;
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
  played_at?: InputMaybe<Scalars["timestamptz"]["input"]>;
}>;

export type InsertPlayEventMutation = {
  __typename?: "mutation_root";
  insert_radio_play_history_one?: {
    __typename?: "radio_play_history";
    id: number;
    played_at?: any | null;
  } | null;
};

export type InsertListenerSnapshotMutationVariables = Exact<{
  count: Scalars["Int"]["input"];
  peak: Scalars["Int"]["input"];
}>;

export type InsertListenerSnapshotMutation = {
  __typename?: "mutation_root";
  insert_radio_listener_snapshots_one?: {
    __typename?: "radio_listener_snapshots";
    id: number;
    recorded_at?: any | null;
  } | null;
};

export type RequestSkipMutationVariables = Exact<{
  track_id?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type RequestSkipMutation = {
  __typename?: "mutation_root";
  insert_radio_skip_requests_one?: {
    __typename?: "radio_skip_requests";
    id: number;
    requested_at?: any | null;
  } | null;
};

export type GetNowPlayingQueryVariables = Exact<{ [key: string]: never }>;

export type GetNowPlayingQuery = {
  __typename?: "query_root";
  radio_play_history: Array<{
    __typename?: "radio_play_history";
    id: number;
    artist: string;
    title: string;
    dj?: string | null;
    played_at?: any | null;
    track_id?: number | null;
  }>;
};

export type GetPlayHistoryQueryVariables = Exact<{
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type GetPlayHistoryQuery = {
  __typename?: "query_root";
  radio_play_history: Array<{
    __typename?: "radio_play_history";
    id: number;
    artist: string;
    title: string;
    dj?: string | null;
    played_at?: any | null;
    track_id?: number | null;
  }>;
};

export type GetListenerCountQueryVariables = Exact<{ [key: string]: never }>;

export type GetListenerCountQuery = {
  __typename?: "query_root";
  radio_listener_snapshots: Array<{
    __typename?: "radio_listener_snapshots";
    id: number;
    count: number;
    peak: number;
    recorded_at?: any | null;
  }>;
};

export type RadioStateQueryVariables = Exact<{ [key: string]: never }>;

export type RadioStateQuery = {
  __typename?: "query_root";
  radio_play_history: Array<{
    __typename?: "radio_play_history";
    id: number;
    artist: string;
    title: string;
    dj?: string | null;
    played_at?: any | null;
  }>;
  radio_listener_snapshots: Array<{
    __typename?: "radio_listener_snapshots";
    count: number;
    peak: number;
    recorded_at?: any | null;
  }>;
};

export type SubscribeNowPlayingSubscriptionVariables = Exact<{
  [key: string]: never;
}>;

export type SubscribeNowPlayingSubscription = {
  __typename?: "subscription_root";
  radio_play_history: Array<{
    __typename?: "radio_play_history";
    id: number;
    artist: string;
    title: string;
    dj?: string | null;
    played_at?: any | null;
    track_id?: number | null;
  }>;
};

export type SubscribeListenersSubscriptionVariables = Exact<{
  [key: string]: never;
}>;

export type SubscribeListenersSubscription = {
  __typename?: "subscription_root";
  radio_listener_snapshots: Array<{
    __typename?: "radio_listener_snapshots";
    id: number;
    count: number;
    peak: number;
    recorded_at?: any | null;
  }>;
};

export type SubscribePlayHistorySubscriptionVariables = Exact<{
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type SubscribePlayHistorySubscription = {
  __typename?: "subscription_root";
  radio_play_history: Array<{
    __typename?: "radio_play_history";
    id: number;
    artist: string;
    title: string;
    dj?: string | null;
    played_at?: any | null;
    track_id?: number | null;
  }>;
};

export const InsertPlayEventDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "InsertPlayEvent" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "artist" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "title" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "dj" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "track_id" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "played_at" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "timestamptz" },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "insert_radio_play_history_one" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "object" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "artist" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "artist" },
                      },
                    },
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "title" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "title" },
                      },
                    },
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "dj" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "dj" },
                      },
                    },
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "track_id" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "track_id" },
                      },
                    },
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "played_at" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "played_at" },
                      },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "played_at" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  InsertPlayEventMutation,
  InsertPlayEventMutationVariables
>;
export const InsertListenerSnapshotDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "InsertListenerSnapshot" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "count" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "peak" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: {
              kind: "Name",
              value: "insert_radio_listener_snapshots_one",
            },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "object" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "count" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "count" },
                      },
                    },
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "peak" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "peak" },
                      },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "recorded_at" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  InsertListenerSnapshotMutation,
  InsertListenerSnapshotMutationVariables
>;
export const RequestSkipDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "RequestSkip" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "track_id" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "insert_radio_skip_requests_one" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "object" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "track_id" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "track_id" },
                      },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "requested_at" },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<RequestSkipMutation, RequestSkipMutationVariables>;
export const GetNowPlayingDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetNowPlaying" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_play_history" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: { kind: "IntValue", value: "1" },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "played_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "artist" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "dj" } },
                { kind: "Field", name: { kind: "Name", value: "played_at" } },
                { kind: "Field", name: { kind: "Name", value: "track_id" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetNowPlayingQuery, GetNowPlayingQueryVariables>;
export const GetPlayHistoryDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetPlayHistory" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          defaultValue: { kind: "IntValue", value: "50" },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_play_history" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "played_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "artist" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "dj" } },
                { kind: "Field", name: { kind: "Name", value: "played_at" } },
                { kind: "Field", name: { kind: "Name", value: "track_id" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetPlayHistoryQuery, GetPlayHistoryQueryVariables>;
export const GetListenerCountDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetListenerCount" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_listener_snapshots" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: { kind: "IntValue", value: "1" },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "recorded_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "count" } },
                { kind: "Field", name: { kind: "Name", value: "peak" } },
                { kind: "Field", name: { kind: "Name", value: "recorded_at" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetListenerCountQuery,
  GetListenerCountQueryVariables
>;
export const RadioStateDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "RadioState" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_play_history" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: { kind: "IntValue", value: "51" },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "played_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "artist" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "dj" } },
                { kind: "Field", name: { kind: "Name", value: "played_at" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_listener_snapshots" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: { kind: "IntValue", value: "1" },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "recorded_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "count" } },
                { kind: "Field", name: { kind: "Name", value: "peak" } },
                { kind: "Field", name: { kind: "Name", value: "recorded_at" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<RadioStateQuery, RadioStateQueryVariables>;
export const SubscribeNowPlayingDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "SubscribeNowPlaying" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_play_history" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: { kind: "IntValue", value: "1" },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "played_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "artist" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "dj" } },
                { kind: "Field", name: { kind: "Name", value: "played_at" } },
                { kind: "Field", name: { kind: "Name", value: "track_id" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SubscribeNowPlayingSubscription,
  SubscribeNowPlayingSubscriptionVariables
>;
export const SubscribeListenersDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "SubscribeListeners" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_listener_snapshots" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: { kind: "IntValue", value: "1" },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "recorded_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "count" } },
                { kind: "Field", name: { kind: "Name", value: "peak" } },
                { kind: "Field", name: { kind: "Name", value: "recorded_at" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SubscribeListenersSubscription,
  SubscribeListenersSubscriptionVariables
>;
export const SubscribePlayHistoryDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "SubscribePlayHistory" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          defaultValue: { kind: "IntValue", value: "50" },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "radio_play_history" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "order_by" },
                value: {
                  kind: "ObjectValue",
                  fields: [
                    {
                      kind: "ObjectField",
                      name: { kind: "Name", value: "played_at" },
                      value: { kind: "EnumValue", value: "desc" },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "artist" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "dj" } },
                { kind: "Field", name: { kind: "Name", value: "played_at" } },
                { kind: "Field", name: { kind: "Name", value: "track_id" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SubscribePlayHistorySubscription,
  SubscribePlayHistorySubscriptionVariables
>;
