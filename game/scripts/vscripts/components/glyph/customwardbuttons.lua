LinkLuaModifier("modifier_kill", LUA_MODIFIER_MOTION_NONE)
LinkLuaModifier("modifier_ward_invisibility", "modifiers/modifier_ward_invisibility.lua", LUA_MODIFIER_MOTION_NONE)
LinkLuaModifier("modifier_ui_custom_observer_ward_charges", "components/glyph/customwardbuttons.lua", LUA_MODIFIER_MOTION_NONE)
LinkLuaModifier("modifier_ui_custom_sentry_ward_charges", "components/glyph/customwardbuttons.lua", LUA_MODIFIER_MOTION_NONE)

if CustomWardButtons == nil then
  -- Debug:EnableDebugging()
  CustomWardButtons = class({})
end

function CustomWardButtons:Init()
  self.moduleName = "Poop Wards"

  self.obs_cooldown = POOP_WARD_COOLDOWN
  self.sentry_cooldown = POOP_WARD_COOLDOWN

  CustomGameEventManager:RegisterListener("custom_ward_button_pressed", Dynamic_Wrap(CustomWardButtons, "CastWard"))
  GameEvents:OnHeroInGame(partial(self.InitCustomWardCharges, self))
end

function CustomWardButtons:InitCustomWardCharges(hero)
  if hero:GetTeamNumber() == DOTA_TEAM_NEUTRALS then
    return
  end

  if hero:IsTempestDouble() or hero:IsClone() then
    return
  end

  --Timers:CreateTimer(2, function ()

  if not hero:HasModifier("modifier_ui_custom_observer_ward_charges") then
    hero:AddNewModifier(hero, nil, "modifier_ui_custom_observer_ward_charges", {cd = self.obs_cooldown})
  end

  if not hero:HasModifier("modifier_ui_custom_sentry_ward_charges") then
    hero:AddNewModifier(hero, nil, "modifier_ui_custom_sentry_ward_charges", {cd = self.sentry_cooldown})
  end

  --end)
end

function CustomWardButtons:CastWard(event)
  local playerID = event.PlayerID
  local ward_type = event.type

  local modifier_name = "modifier_ui_custom_observer_ward_charges"
  local ward_name = "npc_dota_observer_wards"
  if ward_type == "sentry" then
    modifier_name = "modifier_ui_custom_sentry_ward_charges"
    ward_name = "npc_dota_sentry_wards"
  end

  local hero = PlayerResource:GetSelectedHeroEntity(playerID)
  local modifier = hero:FindModifierByName(modifier_name)
  if not modifier then
    CustomGameEventManager:Send_ServerToPlayer(PlayerResource:GetPlayer(playerID), "custom_dota_hud_error_message", {reason = 80, message = "Poop Ward not Found!"})
    return
  end
  local current_charges = modifier:GetStackCount()
  if current_charges == 0 then
    CustomGameEventManager:Send_ServerToPlayer(PlayerResource:GetPlayer(playerID), "custom_dota_hud_error_message", {reason = 61, message = ""})
    return
  end

  modifier:DecrementStackCount()

  local position = hero:GetAbsOrigin()

  local ward = CreateUnitByName(ward_name, position, true, nil, hero, hero:GetTeam())
  ward:AddNewModifier(ward, nil, "modifier_kill", { duration = POOP_WARD_DURATION })
  ward:AddNewModifier(ward, nil, "modifier_ward_invisibility", {})

  if ward_type == "sentry" then
    ward:AddNewModifier(ward, nil, "modifier_item_ward_true_sight", {
      true_sight_range = 700,
      duration = POOP_WARD_DURATION
    })
  end
end

---------------------------------------------------------------------------------------------------

modifier_ui_custom_observer_ward_charges = class({})

function modifier_ui_custom_observer_ward_charges:IsHidden()
  return true
end

function modifier_ui_custom_observer_ward_charges:IsPurgable()
  return false
end

function modifier_ui_custom_observer_ward_charges:RemoveOnDeath()
  return false
end

function modifier_ui_custom_observer_ward_charges:OnCreated(kv)
  if IsServer() then
    local parent = self:GetParent()
    if parent:IsTempestDouble() or parent:IsClone() then
      self:Destroy()
      return
    end

    self.cd = kv.cd

    self:SetStackCount(1)
    self:StartIntervalThink(0.1)
    self:SetDuration(self.cd, false)
  end
end

function modifier_ui_custom_observer_ward_charges:OnIntervalThink()
  local remaining = self:GetRemainingTime()
  if remaining < 1 then
    self:IncrementStackCount()
    self:SetDuration(self.cd, false)
  end
end

---------------------------------------------------------------------------------------------------

modifier_ui_custom_sentry_ward_charges = class({})

function modifier_ui_custom_sentry_ward_charges:IsHidden()
  return true
end

function modifier_ui_custom_sentry_ward_charges:IsPurgable()
  return false
end

function modifier_ui_custom_sentry_ward_charges:RemoveOnDeath()
  return false
end

function modifier_ui_custom_sentry_ward_charges:OnCreated(kv)
  if IsServer() then
    local parent = self:GetParent()
    if parent:IsTempestDouble() or parent:IsClone() then
      self:Destroy()
      return
    end

    self.cd = kv.cd

    self:SetStackCount(1)
    self:StartIntervalThink(0.1)
    self:SetDuration(self.cd, false)
  end
end

function modifier_ui_custom_sentry_ward_charges:OnIntervalThink()
  local remaining = self:GetRemainingTime()
  if remaining < 1 then
    self:IncrementStackCount()
    self:SetDuration(self.cd, false)
  end
end
