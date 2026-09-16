import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default(""),
  statusText: text("status_text").notNull().default(""),
  presence: text("presence", { enum: ["online", "idle", "offline"] }).notNull().default("offline"),
  lastSeenAt: text("last_seen_at"),
  dailyMedals: integer("daily_medals").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_players_presence").on(table.presence)]);

export const playerStats = sqliteTable("player_stats", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  cash: integer("cash").notNull().default(0),
  xp: integer("xp").notNull().default(0),
  fishCaught: integer("fish_caught").notNull().default(0),
  shinyFishCaught: integer("shiny_fish_caught").notNull().default(0),
  questsCompleted: integer("quests_completed").notNull().default(0),
  fishSold: integer("fish_sold").notNull().default(0),
  moneyEarned: integer("money_earned").notNull().default(0),
  moneySpent: integer("money_spent").notNull().default(0),
  orbsClicked: integer("orbs_clicked").notNull().default(0),
  playtimeSeconds: integer("playtime_seconds").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dailyCategories = sqliteTable("daily_categories", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  metric: text("metric").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const dailyChallenges = sqliteTable("daily_challenges", {
  challengeDate: text("challenge_date").primaryKey(),
  categoryKey: text("category_key").notNull().references(() => dailyCategories.key),
  selectionMode: text("selection_mode", { enum: ["random", "scheduled"] }).notNull(),
  status: text("status", { enum: ["scheduled", "active", "finalized", "ineligible"] }).notNull().default("scheduled"),
  winnerPlayerId: text("winner_player_id").references(() => players.id),
  finalizedAt: text("finalized_at"),
}, (table) => [index("idx_daily_challenges_category").on(table.categoryKey)]);

export const dailyScores = sqliteTable("daily_scores", {
  challengeDate: text("challenge_date").notNull().references(() => dailyChallenges.challengeDate),
  playerId: text("player_id").notNull().references(() => players.id),
  baselineValue: integer("baseline_value").notNull(),
  latestValue: integer("latest_value").notNull(),
  score: integer("score").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.challengeDate, table.playerId] }),
  index("idx_daily_scores_rank").on(table.challengeDate, table.score),
]);

export const tournaments = sqliteTable("tournaments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  metric: text("metric").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  status: text("status", { enum: ["draft", "scheduled", "active", "finalized"] }).notNull().default("draft"),
});

export const trophies = sqliteTable("trophies", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  placement: integer("placement").notNull(),
  score: integer("score"),
  awardedAt: text("awarded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_trophies_player").on(table.playerId),
  index("idx_trophies_tournament").on(table.tournamentId),
]);

export const adminAudit = sqliteTable("admin_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminUserId: text("admin_user_id").notNull(),
  playerId: text("player_id").references(() => players.id),
  action: text("action").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_admin_audit_player").on(table.playerId, table.createdAt)]);
