from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    wp_cors_origins: str = "http://localhost:5173"
    anthropic_api_key: str = ""
    # Claude on Microsoft Foundry; used instead of ANTHROPIC_API_KEY when both are set
    anthropic_foundry_api_key: str = ""
    anthropic_foundry_resource: str = ""  # e.g. "my-resource" for https://my-resource.services.ai.azure.com
    wp_llm_model: str = "claude-haiku-5-5"  # on Foundry this is the deployment name
    livekit_url: str = "ws://localhost:7880"
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    tmdb_api_key: str = ""
    giphy_api_key: str = ""  # GIFs and stickers in chat; the picker hides them when unset
    # party lifecycle
    wp_max_participants: int = 20
    wp_idle_room_minutes: float = 30  # rooms with nobody online this long are closed
    wp_room_max_age_hours: float = 12
    wp_sweep_interval_s: float = 30  # also how promptly a host who went away hands over (after 2 min)
    wp_prune_member_hours: float = 4  # forget members gone this long (0 keeps everyone until the room ends)
    wp_data_dir: str = ""  # persistent files such as recs.json; defaults to backend/var

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.wp_cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
