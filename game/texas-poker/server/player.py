class Player:
    def __init__(self, player_id, name, chips):
        self.id = player_id
        self.name = name
        self.chips = chips
        self.current_bet = 0
        self.total_bet = 0
        self.hand = []
        self.action = ""
        self.state = "active"
        self.is_current = False
        self.has_acted = False

    def to_dict(self, show_hand=False):
        return {
            "id": self.id,
            "name": self.name,
            "chips": self.chips,
            "currentBet": self.current_bet,
            "totalBet": self.total_bet,
            "hand": self.hand if show_hand else [],
            "action": self.action,
            "state": self.state,
            "isCurrent": self.is_current,
        }

    def fold(self):
        self.state = "folded"
        self.action = "fold"
        self.is_current = False

    def check(self):
        self.action = "check"
        self.has_acted = True

    def call(self, amount):
        call_amount = min(amount, self.chips)
        self.chips -= call_amount
        self.current_bet += call_amount
        self.action = "call"
        self.has_acted = True

    def raise_bet(self, raise_amount):
        total_bet = raise_amount - self.current_bet
        actual_bet = min(total_bet, self.chips)
        self.chips -= actual_bet
        self.current_bet += actual_bet
        self.action = "raise"
        self.has_acted = True

    def reset_for_new_hand(self, initial_chips=None):
        self.current_bet = 0
        self.total_bet = 0
        self.hand = []
        self.action = ""
        self.has_acted = False
        self.is_current = False
        if self.state in ("folded", "all_in"):
            self.state = "active"
        if initial_chips is not None:
            self.chips = initial_chips

    def is_active(self):
        return self.state == "active"

    def is_out(self):
        return self.state == "out"
