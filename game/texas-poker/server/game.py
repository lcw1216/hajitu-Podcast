import logging
from player import Player
from deck import Deck
from hand_eval import eval_hand_full, compare_with_scores, get_hand_name

logger = logging.getLogger(__name__)

PHASES = ["idle", "preflop", "flop", "turn", "river", "showdown"]
MIN_PLAYERS = 2


class GameState:
    def __init__(self, room_id, small_blind=10, big_blind=20, max_players=8, initial_chips=1000, log_callback=None):
        self.room_id = room_id
        self.small_blind = small_blind
        self.big_blind = big_blind
        self.max_players = max_players
        self.initial_chips = initial_chips
        self.log_callback = log_callback

        self.phase = "idle"
        self.players = []
        self.community_cards = []
        self.pot = 0
        self.current_bet = 0
        self.min_raise = big_blind
        self.dealer_index = 0
        self.current_player_index = 0
        self.deck = None
        self._acted_count = 0
        self.last_raise_amount = big_blind
        self._pending_hand_result = None

    def _log_action(self, player_id, action, amount=0):
        if self.log_callback:
            try:
                self.log_callback(self.room_id, player_id, action, amount)
            except Exception as e:
                logger.error(f"Failed to log game action: {e}")

    def add_player(self, player_id, name, chips=None):
        if len(self.players) >= self.max_players:
            raise ValueError("房间已满")
        if any(p.id == player_id for p in self.players):
            raise ValueError("玩家已在房间")
        player = Player(player_id, name, chips or self.initial_chips)
        self.players.append(player)
        logger.info(f"Player {name} (id={player_id}) joined room {self.room_id}")
        return player

    def remove_player(self, player_id):
        self.players = [p for p in self.players if p.id != player_id]
        logger.info(f"Player id={player_id} removed from room {self.room_id}")

    def start_game(self):
        active_players = [p for p in self.players if not p.is_out()]
        if len(active_players) < 2:
            raise ValueError("至少需要2名玩家")

        self.deck = Deck()
        self.deck.shuffle()
        self.community_cards = []
        self.pot = 0
        self.current_bet = 0
        self.min_raise = self.big_blind
        self.last_raise_amount = self.big_blind
        self._acted_count = 0

        for p in self.players:
            if p.chips <= 0:
                p.reset_for_new_hand(self.initial_chips)
            else:
                p.reset_for_new_hand()

        self.dealer_index = self._next_active_index(self.dealer_index)

        self._deal_hole_cards()
        self._post_blinds()
        self.phase = "preflop"
        self._set_first_player()

        logger.info(f"Game started in room {self.room_id}, phase={self.phase}")
        return self.get_state()

    def _next_active_index(self, current_index):
        n = len(self.players)
        if n == 0:
            raise ValueError("没有活跃玩家")
        idx = (current_index + 1) % n
        attempts = 0
        while self.players[idx].is_out() and attempts < n:
            idx = (idx + 1) % n
            attempts += 1
        if attempts >= n:
            raise ValueError("没有活跃玩家")
        return idx

    def _deal_hole_cards(self):
        for player in self.players:
            if not player.is_out():
                player.hand = [self.deck.deal(), self.deck.deal()]

    def _post_blinds(self):
        n = len(self.players)

        sb_index = self._next_active_index(self.dealer_index)
        bb_index = self._next_active_index(sb_index)

        sb_player = self.players[sb_index]
        bb_player = self.players[bb_index]

        sb_amount = min(self.small_blind, sb_player.chips)
        sb_player.chips -= sb_amount
        sb_player.current_bet = sb_amount
        sb_player.total_bet = sb_amount
        self.pot += sb_amount
        if sb_player.chips == 0:
            sb_player.state = "all_in"

        bb_amount = min(self.big_blind, bb_player.chips)
        bb_player.chips -= bb_amount
        bb_player.current_bet = bb_amount
        bb_player.total_bet = bb_amount
        self.pot += bb_amount
        if bb_player.chips == 0:
            bb_player.state = "all_in"

        self.current_bet = self.big_blind

    def _set_first_player(self):
        n = len(self.players)
        if self.phase == "preflop":
            start = (self.dealer_index + 3) % n
        else:
            start = (self.dealer_index + 1) % n

        attempts = 0
        while (self.players[start].is_out() or self.players[start].state == "folded") and attempts < n:
            start = (start + 1) % n
            attempts += 1

        if attempts >= n:
            raise ValueError("没有可行动的玩家")

        self.current_player_index = start
        self.players[self.current_player_index].is_current = True
        self._acted_count = 0

    def process_action(self, player_id, action, amount=0):
        player = self._get_player(player_id)
        if not player or not player.is_current:
            raise ValueError("不是当前玩家的回合")

        is_all_in = False

        if action == "fold":
            player.fold()
            self._log_action(player_id, "fold")
        elif action == "check":
            if player.current_bet < self.current_bet:
                raise ValueError("不能过牌，需要跟注")
            player.check()
            self._log_action(player_id, "check")
        elif action == "call":
            chips_before = player.chips
            call_amount = self.current_bet - player.current_bet
            player.call(call_amount)
            self.pot += chips_before - player.chips
            player.total_bet += chips_before - player.chips
            if player.chips == 0:
                player.state = "all_in"
            self._log_action(player_id, "call", call_amount)
        elif action == "raise":
            chips_before = player.chips
            raise_amount = max(amount, self.current_bet + self.min_raise)
            if raise_amount > player.chips + player.current_bet:
                raise_amount = player.chips + player.current_bet
                is_all_in = True

            if is_all_in:
                self.last_raise_amount = 0
            else:
                self.last_raise_amount = raise_amount - self.current_bet
                self.min_raise = max(self.big_blind, self.last_raise_amount)

            player.raise_bet(raise_amount)
            self.pot += chips_before - player.chips
            player.total_bet += chips_before - player.chips
            self.current_bet = player.current_bet
            if is_all_in:
                player.state = "all_in"
            self._log_action(player_id, "raise" if not is_all_in else "all-in", raise_amount)
        else:
            raise ValueError(f"无效操作: {action}")

        self._acted_count += 1
        player.is_current = False

        if self._is_betting_round_over():
            self._next_phase()
        else:
            self._move_to_next_player()

        result = self.get_state()
        if self._pending_hand_result:
            result["hand_result"] = self._pending_hand_result
            self._pending_hand_result = None
        return result

    def _is_betting_round_over(self):
        active_players = [p for p in self.players if p.is_active()]

        if len(active_players) <= 1:
            return True

        can_act_players = [p for p in active_players if p.chips > 0]

        if not can_act_players:
            return True

        all_matched = all(p.current_bet >= self.current_bet for p in can_act_players)
        all_acted = self._acted_count >= len(active_players)

        return all_matched and all_acted

    def _next_phase(self):
        for p in self.players:
            p.current_bet = 0
            p.has_acted = False
        self._acted_count = 0
        self.current_bet = 0
        self.min_raise = self.big_blind

        phase_idx = PHASES.index(self.phase)
        if phase_idx >= len(PHASES) - 1:
            self._pending_hand_result = self._showdown()
            self._reset_for_new_hand()
            return

        next_phase = PHASES[phase_idx + 1]

        if next_phase == "showdown":
            self._pending_hand_result = self._showdown()
            self._reset_for_new_hand()
            return

        self.phase = next_phase

        if next_phase == "flop":
            self.community_cards.extend(self.deck.deal_cards(3))
        elif next_phase in ("turn", "river"):
            self.community_cards.append(self.deck.deal())

        active_players = [p for p in self.players if p.is_active()]
        all_in_players = [p for p in self.players if p.state == "all_in"]
        can_act_players = [p for p in active_players if p.chips > 0]

        if len(active_players) == 0 and len(all_in_players) <= 1:
            self._showdown()
            return

        if len(active_players) <= 1 and len(all_in_players) == 0:
            self._showdown()
            return

        if not can_act_players:
            while len(self.community_cards) < 5:
                if len(self.community_cards) == 0:
                    self.community_cards.extend(self.deck.deal_cards(3))
                else:
                    self.community_cards.append(self.deck.deal())
            self._showdown()
            return

        self._set_first_player()
        logger.info(f"Phase changed to {self.phase}")

    def _calculate_pots(self):
        all_players = [p for p in self.players if p.is_active() or p.state == "all_in"]
        if not all_players:
            return []

        bets = sorted(set(p.total_bet for p in all_players if p.total_bet > 0))
        pots = []
        prev_level = 0

        for level in bets:
            pot_amount = 0
            eligible = []
            for p in self.players:
                contribution = min(p.total_bet, level) - min(p.total_bet, prev_level)
                pot_amount += contribution
                if (p.is_active() or p.state == "all_in") and p.total_bet >= level:
                    eligible.append(p)
            if pot_amount > 0 and eligible:
                pots.append({"amount": pot_amount, "eligible": eligible})
            prev_level = level

        return pots

    def _showdown(self):
        self.phase = "showdown"
        active_players = [p for p in self.players if p.is_active() or p.state == "all_in"]

        if len(active_players) == 1:
            winner = active_players[0]
            win_amount = self.pot
            winner.chips += win_amount
            winner_data = [{
                "playerId": winner.id,
                "handName": "",
                "handRank": -1,
                "winAmount": win_amount,
            }]
            player_hands = [{
                "playerId": winner.id,
                "hand": winner.hand,
                "handName": "",
                "handRank": -1,
            }]
        else:
            pots = self._calculate_pots()
            winner_data = []
            player_hand_map = {}

            for p in active_players:
                seven_cards = Deck.cards_to_encoded(p.hand) + Deck.cards_to_encoded(self.community_cards)
                score = eval_hand_full(seven_cards)
                player_hand_map[p.id] = {
                    "player": p,
                    "rank": score["rank"],
                    "kickers": score["kickers"],
                    "hand_name": get_hand_name(score["rank"]),
                }

            total_winnings = {}

            for pot_info in pots:
                eligible = pot_info["eligible"]
                pot_amount = pot_info["amount"]

                best = None
                winners = []
                for p in eligible:
                    info = player_hand_map.get(p.id)
                    if not info:
                        continue
                    if best is None:
                        best = info
                        winners = [p]
                    else:
                        if info["rank"] != best["rank"]:
                            cmp = info["rank"] - best["rank"]
                        else:
                            cmp = compare_with_scores(
                                info["rank"], info["kickers"],
                                best["rank"], best["kickers"],
                            )
                        if cmp > 0:
                            best = info
                            winners = [p]
                        elif cmp == 0:
                            winners.append(p)

                if winners:
                    share = pot_amount // len(winners)
                    for w in winners:
                        total_winnings[w.id] = total_winnings.get(w.id, 0) + share

            for p_id, win_amount in total_winnings.items():
                p = self._get_player(p_id)
                if p:
                    p.chips += win_amount
                    info = player_hand_map.get(p_id, {})
                    winner_data.append({
                        "playerId": p_id,
                        "handName": info.get("hand_name", ""),
                        "handRank": info.get("rank", -1),
                        "winAmount": win_amount,
                    })

            player_hands = []
            for p in active_players:
                info = player_hand_map.get(p.id, {})
                player_hands.append({
                    "playerId": p.id,
                    "hand": p.hand,
                    "handName": info.get("hand_name", ""),
                    "handRank": info.get("rank", -1),
                })

        for p in self.players:
            if p.chips <= 0 and (p.is_active() or p.state == "all_in"):
                p.state = "out"

        self.pot = 0
        logger.info(f"Showdown complete, winners: {[w['playerId'] for w in winner_data]}")

        for w in winner_data:
            self._log_action(w["playerId"], "win", w["winAmount"])

        return {
            "type": "hand_result",
            "data": {
                "winners": winner_data,
                "players": player_hands,
            },
        }

    def _move_to_next_player(self):
        n = len(self.players)
        next_idx = (self.current_player_index + 1) % n
        attempts = 0
        while attempts < n:
            p = self.players[next_idx]
            if p.is_active():
                self.current_player_index = next_idx
                p.is_current = True
                return
            next_idx = (next_idx + 1) % n
            attempts += 1

    def _get_player(self, player_id):
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def get_state(self, requesting_player_id=None):
        return {
            "type": "game_state",
            "data": {
                "phase": self.phase,
                "communityCards": self.community_cards,
                "players": [p.to_dict(show_hand=(p.id == requesting_player_id)) for p in self.players],
                "pot": self.pot,
                "currentBet": self.current_bet,
                "dealerIndex": self.dealer_index,
                "currentPlayerIndex": self.current_player_index,
                "minRaise": self.min_raise,
            },
        }

    def get_player_count(self):
        return len([p for p in self.players if not p.is_out()])

    def _reset_for_new_hand(self):
        for p in self.players:
            p.hand = []
            p.current_bet = 0
            p.total_bet = 0
            p.action = ""
            p.has_acted = False
            p.is_current = False
            if p.state == "folded":
                p.state = "active"
            if p.chips <= 0 and p.state != "out":
                p.state = "out"
        self.community_cards = []
        self.pot = 0
        self.current_bet = 0
        self.min_raise = self.big_blind
        self.last_raise_amount = self.big_blind
        self.deck = None
        self._acted_count = 0
        self.phase = "idle"
