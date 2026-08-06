import random


class Deck:
    SUITS = ["♠", "♥", "♦", "♣"]
    RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]

    def __init__(self):
        self.cards = []
        self._build()

    def _build(self):
        self.cards = []
        for rank_idx, rank in enumerate(self.RANKS):
            for suit_idx, suit in enumerate(self.SUITS):
                card_id = rank_idx * 4 + suit_idx
                self.cards.append({
                    "id": card_id,
                    "rank": rank,
                    "suit": suit,
                    "rank_idx": rank_idx,
                    "suit_idx": suit_idx,
                })

    def shuffle(self):
        random.SystemRandom().shuffle(self.cards)

    def deal(self):
        if not self.cards:
            raise RuntimeError("牌堆已空")
        return self.cards.pop()

    def deal_cards(self, count):
        if count > len(self.cards):
            raise RuntimeError(f"牌堆不足，需要{count}张，剩余{len(self.cards)}张")
        return [self.deal() for _ in range(count)]

    def remaining(self):
        return len(self.cards)

    def reset(self):
        self._build()
        self.shuffle()

    @staticmethod
    def card_to_encoded(card):
        return card["id"]

    @staticmethod
    def encoded_to_card(encoded):
        rank_idx = encoded // 4
        suit_idx = encoded % 4
        return {
            "id": encoded,
            "rank": Deck.RANKS[rank_idx],
            "suit": Deck.SUITS[suit_idx],
            "rank_idx": rank_idx,
            "suit_idx": suit_idx,
        }

    @staticmethod
    def cards_to_encoded(cards):
        return [Deck.card_to_encoded(c) for c in cards]

    @staticmethod
    def encoded_to_cards(encoded_list):
        return [Deck.encoded_to_card(e) for e in encoded_list]
