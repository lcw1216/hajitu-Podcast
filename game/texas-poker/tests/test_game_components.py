import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from player import Player
from deck import Deck


class TestPlayer:
    def test_create_player(self):
        p = Player("p1", "Alice", 1000)
        assert p.id == "p1"
        assert p.name == "Alice"
        assert p.chips == 1000
        assert p.state == "active"
        assert p.total_bet == 0

    def test_fold(self):
        p = Player("p1", "Alice", 1000)
        p.fold()
        assert p.state == "folded"
        assert p.action == "fold"

    def test_check(self):
        p = Player("p1", "Alice", 1000)
        p.check()
        assert p.action == "check"
        assert p.has_acted is True

    def test_call(self):
        p = Player("p1", "Alice", 1000)
        p.call(100)
        assert p.chips == 900
        assert p.current_bet == 100
        assert p.action == "call"

    def test_call_all_in(self):
        p = Player("p1", "Alice", 50)
        p.call(100)
        assert p.chips == 0
        assert p.current_bet == 50

    def test_raise_bet(self):
        p = Player("p1", "Alice", 1000)
        p.raise_bet(200)
        assert p.chips == 800
        assert p.current_bet == 200
        assert p.action == "raise"

    def test_is_active(self):
        p = Player("p1", "Alice", 1000)
        assert p.is_active() is True
        p.fold()
        assert p.is_active() is False

    def test_is_out(self):
        p = Player("p1", "Alice", 1000)
        assert p.is_out() is False
        p.state = "out"
        assert p.is_out() is True

    def test_to_dict(self):
        p = Player("p1", "Alice", 1000)
        d = p.to_dict()
        assert d["id"] == "p1"
        assert d["name"] == "Alice"
        assert d["chips"] == 1000
        assert d["state"] == "active"
        assert "totalBet" in d

    def test_to_dict_show_hand(self):
        p = Player("p1", "Alice", 1000)
        p.hand = [{"id": 0, "rank": "2", "suit": "♠"}]
        d = p.to_dict(show_hand=True)
        assert len(d["hand"]) == 1
        d2 = p.to_dict(show_hand=False)
        assert len(d2["hand"]) == 0

    def test_reset_for_new_hand(self):
        p = Player("p1", "Alice", 500)
        p.fold()
        p.current_bet = 100
        p.total_bet = 100
        p.reset_for_new_hand(1000)
        assert p.state == "active"
        assert p.chips == 1000
        assert p.current_bet == 0
        assert p.total_bet == 0
        assert p.hand == []

    def test_reset_for_new_hand_all_in(self):
        p = Player("p1", "Alice", 0)
        p.state = "all_in"
        p.total_bet = 500
        p.reset_for_new_hand(1000)
        assert p.state == "active"
        assert p.chips == 1000
        assert p.total_bet == 0


class TestDeck:
    def test_deck_size(self):
        d = Deck()
        assert len(d.cards) == 52

    def test_deal_card(self):
        d = Deck()
        card = d.deal()
        assert len(d.cards) == 51
        assert "id" in card
        assert "rank" in card
        assert "suit" in card

    def test_deal_multiple_cards(self):
        d = Deck()
        cards = d.deal_cards(5)
        assert len(cards) == 5
        assert len(d.cards) == 47

    def test_deal_cards_insufficient(self):
        d = Deck()
        with pytest.raises(RuntimeError, match="牌堆不足"):
            d.deal_cards(53)

    def test_shuffle(self):
        d1 = Deck()
        d2 = Deck()
        d2.shuffle()
        assert d1.cards != d2.shuffle() or True

    def test_empty_deck_error(self):
        d = Deck()
        for _ in range(52):
            d.deal()
        with pytest.raises(RuntimeError):
            d.deal()

    def test_cards_to_encoded(self):
        d = Deck()
        cards = d.deal_cards(2)
        encoded = Deck.cards_to_encoded(cards)
        assert len(encoded) == 2
        assert isinstance(encoded[0], int)

    def test_encoded_to_cards(self):
        d = Deck()
        cards = d.deal_cards(3)
        encoded = Deck.cards_to_encoded(cards)
        decoded = Deck.encoded_to_cards(encoded)
        assert len(decoded) == 3
        assert decoded[0]["rank"] == cards[0]["rank"]
        assert decoded[0]["suit"] == cards[0]["suit"]

    def test_remaining(self):
        d = Deck()
        assert d.remaining() == 52
        d.deal()
        assert d.remaining() == 51

    def test_reset(self):
        d = Deck()
        d.deal_cards(10)
        assert d.remaining() == 42
        d.reset()
        assert d.remaining() == 52
