import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from game import GameState
from player import Player
from deck import Deck


class TestGameStateInit:
    def test_create_game(self):
        game = GameState("room_1")
        assert game.room_id == "room_1"
        assert game.phase == "idle"
        assert game.pot == 0
        assert game.players == []

    def test_add_player(self):
        game = GameState("room_1")
        p = game.add_player(1, "Alice")
        assert p.name == "Alice"
        assert p.chips == 1000
        assert len(game.players) == 1

    def test_add_player_custom_chips(self):
        game = GameState("room_1")
        p = game.add_player(1, "Alice", chips=500)
        assert p.chips == 500

    def test_add_duplicate_player(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        with pytest.raises(ValueError, match="已在房间"):
            game.add_player(1, "Alice")

    def test_add_player_room_full(self):
        game = GameState("room_1", max_players=2)
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        with pytest.raises(ValueError, match="房间已满"):
            game.add_player(3, "Charlie")

    def test_remove_player(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.remove_player(1)
        assert len(game.players) == 1
        assert game.players[0].id == 2

    def test_start_game_needs_two_players(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        with pytest.raises(ValueError, match="至少需要2名玩家"):
            game.start_game()


class TestGameStateFlow:
    def _create_two_player_game(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        return game

    def test_start_game_phase(self):
        game = self._create_two_player_game()
        state = game.start_game()
        assert game.phase == "preflop"
        assert state["type"] == "game_state"

    def test_start_game_deals_cards(self):
        game = self._create_two_player_game()
        game.start_game()
        for p in game.players:
            assert len(p.hand) == 2

    def test_start_game_posts_blinds(self):
        game = self._create_two_player_game()
        game.start_game()
        active = [p for p in game.players if not p.is_out()]
        bets = [p.current_bet for p in active]
        assert 10 in bets
        assert 20 in bets
        assert game.pot == 30

    def test_fold_ends_hand(self):
        game = self._create_two_player_game()
        game.start_game()
        current_id = game.players[game.current_player_index].id
        game.process_action(current_id, "fold")
        assert game.phase == "showdown"

    def test_check_and_fold_flow(self):
        game = self._create_two_player_game()
        game.start_game()

        current_id = game.players[game.current_player_index].id
        if game.players[game.current_player_index].current_bet < game.current_bet:
            game.process_action(current_id, "call", 0)
        else:
            game.process_action(current_id, "check")

        current_id = game.players[game.current_player_index].id
        game.process_action(current_id, "check")

        assert game.phase == "flop"

    def test_full_hand_to_showdown(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        phases_seen = [game.phase]

        while game.phase not in ("showdown", "idle"):
            current_id = game.players[game.current_player_index].id
            player = game.players[game.current_player_index]

            if player.current_bet < game.current_bet:
                game.process_action(current_id, "call")
            else:
                game.process_action(current_id, "check")

            if game.phase != phases_seen[-1]:
                phases_seen.append(game.phase)

        assert "flop" in phases_seen
        assert "turn" in phases_seen
        assert "river" in phases_seen
        assert "showdown" in phases_seen

    def test_raise_action(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        current_id = game.players[game.current_player_index].id
        player = game.players[game.current_player_index]

        if player.current_bet < game.current_bet:
            game.process_action(current_id, "call")

        current_id = game.players[game.current_player_index].id
        game.process_action(current_id, "raise", 60)

        assert game.current_bet == 60

    def test_all_in_scenario(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice", chips=30)
        game.add_player(2, "Bob", chips=1000)
        game.start_game()

        current_id = game.players[game.current_player_index].id
        player = game.players[game.current_player_index]

        if player.current_bet < game.current_bet:
            game.process_action(current_id, "call")

        current_id = game.players[game.current_player_index].id
        game.process_action(current_id, "raise", 1000)

        assert any(p.chips == 0 for p in game.players if not p.is_out())


class TestThreePlayerGame:
    def _create_three_player_game(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.add_player(3, "Charlie")
        return game

    def test_three_player_start(self):
        game = self._create_three_player_game()
        game.start_game()
        assert game.phase == "preflop"
        assert len([p for p in game.players if p.hand]) == 3

    def test_three_player_fold_one(self):
        game = self._create_three_player_game()
        game.start_game()

        current_id = game.players[game.current_player_index].id
        game.process_action(current_id, "fold")

        active = [p for p in game.players if p.is_active()]
        assert len(active) == 2

    def test_three_player_all_fold_to_one(self):
        game = self._create_three_player_game()
        game.start_game()

        for _ in range(2):
            current_id = game.players[game.current_player_index].id
            game.process_action(current_id, "fold")

        assert game.phase == "showdown"

    def test_three_player_full_hand(self):
        game = self._create_three_player_game()
        game.start_game()

        max_actions = 50
        actions = 0
        while game.phase not in ("showdown", "idle") and actions < max_actions:
            current_id = game.players[game.current_player_index].id
            player = game.players[game.current_player_index]

            if player.current_bet < game.current_bet:
                game.process_action(current_id, "call")
            else:
                game.process_action(current_id, "check")
            actions += 1

        assert game.phase == "showdown"


class TestNextActiveIndex:
    def test_skips_out_players(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.add_player(3, "Charlie")

        game.players[1].state = "out"

        idx = game._next_active_index(0)
        assert game.players[idx].is_out() is False

    def test_wraps_around(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.add_player(3, "Charlie")

        game.players[0].state = "out"
        game.players[1].state = "out"

        idx = game._next_active_index(1)
        assert idx == 2
        assert game.players[idx].is_out() is False


class TestGetState:
    def test_get_state_structure(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        state = game.get_state()
        assert state["type"] == "game_state"
        assert "data" in state
        data = state["data"]
        assert data["phase"] == "preflop"
        assert "players" in data
        assert "pot" in data
        assert "communityCards" in data
        assert "currentBet" in data

    def test_get_state_hides_hands(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        state = game.get_state(requesting_player_id=1)
        for p_data in state["data"]["players"]:
            if p_data["id"] == 1:
                assert len(p_data["hand"]) == 2
            else:
                assert len(p_data["hand"]) == 0

    def test_get_player_count(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.add_player(3, "Charlie")

        assert game.get_player_count() == 3

        game.players[1].state = "out"
        assert game.get_player_count() == 2


class TestShowdown:
    def test_showdown_distributes_pot(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        max_actions = 50
        actions = 0
        while game.phase not in ("showdown", "idle") and actions < max_actions:
            current_id = game.players[game.current_player_index].id
            player = game.players[game.current_player_index]

            if player.current_bet < game.current_bet:
                game.process_action(current_id, "call")
            else:
                game.process_action(current_id, "check")
            actions += 1

        assert game.phase == "showdown"
        total_chips = sum(p.chips for p in game.players)
        assert total_chips == 2000

    def test_showdown_player_out_when_broke(self):
        game = GameState("room_1", small_blind=500, big_blind=500, initial_chips=500)
        game.add_player(1, "Alice", chips=500)
        game.add_player(2, "Bob", chips=500)
        game.start_game()

        max_actions = 50
        actions = 0
        while game.phase not in ("showdown", "idle") and actions < max_actions:
            current_id = game.players[game.current_player_index].id
            player = game.players[game.current_player_index]

            if player.current_bet < game.current_bet:
                game.process_action(current_id, "call")
            else:
                game.process_action(current_id, "check")
            actions += 1

        assert game.phase == "showdown"
        out_players = [p for p in game.players if p.is_out()]
        assert len(out_players) >= 1


class TestProcessActionValidation:
    def test_action_not_current_player(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        non_current = None
        for p in game.players:
            if not p.is_current:
                non_current = p
                break

        with pytest.raises(ValueError, match="不是当前玩家的回合"):
            game.process_action(non_current.id, "check")

    def test_check_when_bet_required(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        current_id = game.players[game.current_player_index].id
        player = game.players[game.current_player_index]

        if player.current_bet < game.current_bet:
            with pytest.raises(ValueError, match="不能过牌"):
                game.process_action(current_id, "check")

    def test_invalid_action(self):
        game = GameState("room_1")
        game.add_player(1, "Alice")
        game.add_player(2, "Bob")
        game.start_game()

        current_id = game.players[game.current_player_index].id
        with pytest.raises(ValueError, match="无效操作"):
            game.process_action(current_id, "invalid_action")


class TestSidePots:
    def test_side_pot_calculation(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice", chips=100)
        game.add_player(2, "Bob", chips=1000)
        game.add_player(3, "Charlie", chips=1000)
        game.start_game()

        max_actions = 100
        actions = 0
        while game.phase not in ("showdown", "idle") and actions < max_actions:
            current_id = game.players[game.current_player_index].id
            player = game.players[game.current_player_index]

            if player.current_bet < game.current_bet:
                game.process_action(current_id, "call")
            else:
                game.process_action(current_id, "check")
            actions += 1

        assert game.phase == "showdown"

    def test_total_chips_conserved(self):
        game = GameState("room_1", small_blind=10, big_blind=20)
        game.add_player(1, "Alice", chips=500)
        game.add_player(2, "Bob", chips=500)
        game.add_player(3, "Charlie", chips=500)
        game.start_game()

        initial_total = 1500
        max_actions = 100
        actions = 0
        while game.phase not in ("showdown", "idle") and actions < max_actions:
            current_id = game.players[game.current_player_index].id
            player = game.players[game.current_player_index]

            if player.current_bet < game.current_bet:
                game.process_action(current_id, "call")
            else:
                game.process_action(current_id, "check")
            actions += 1

        assert game.phase == "showdown"
        total_chips = sum(p.chips for p in game.players)
        assert total_chips == initial_total
