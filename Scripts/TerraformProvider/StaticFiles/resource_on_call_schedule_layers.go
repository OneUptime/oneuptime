package provider

// oneuptime_on_call_schedule_layers: who takes turns in each layer of an
// on-call schedule, in turn order, and the order of the layers, saved all at
// once (OneUptime/oneuptime#9038).
//
// Written by hand: the API gives no record for it. It is what the
// dashboard's Save changes on a schedule's Layers page sends,
// POST /on-call-duty-policy-schedule/:id/save-layers, read back with
// GET /on-call-duty-policy-schedule/:id/layers. One save writes all of a
// change or none of it, in one transaction with the schedule held, and who is
// on call is worked out once, at once. Written row by row through
// oneuptime_on_call_schedule_layer_user, an apply that failed half way left a
// layer with half its new turn order, and the change was told only once the
// layers had been quiet for half a minute.
//
// The layers themselves, and their settings - name, rotation, hand-off,
// restrictions - are oneuptime_on_call_schedule_layer resources. This one
// lists layers of the schedule by their IDs, the highest priority first, each
// with the people who take turns in it. A layer it does not list keeps its
// people and its place, so a layer removed from the configuration can be
// deleted by its own resource in the same apply.
//
// Every save is made to the layers as they are read just before it (the
// version they are at, basedOnVersion), and read again and made again when
// someone changed them in between: OneUptime refuses, with 409, a save made
// to layers that changed since they were read.

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/listvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var (
	_ resource.Resource                   = &OnCallScheduleLayersResource{}
	_ resource.ResourceWithConfigure      = &OnCallScheduleLayersResource{}
	_ resource.ResourceWithImportState    = &OnCallScheduleLayersResource{}
	_ resource.ResourceWithValidateConfig = &OnCallScheduleLayersResource{}
)

// How many times a save is made when the layers keep changing between the
// read it is made to and the save.
const scheduleLayersSaveAttempts = 3

// The schedule resource, and the layer resource, whose IDs this one takes.
const (
	scheduleLayersScheduleType = "oneuptime_on_call_policy_schedule"
	scheduleLayersLayerType    = "oneuptime_on_call_schedule_layer"
)

func NewOnCallScheduleLayersResource() resource.Resource {
	return &OnCallScheduleLayersResource{}
}

// OnCallScheduleLayersResource defines the resource implementation.
type OnCallScheduleLayersResource struct {
	client *Client
}

// OnCallScheduleLayersResourceModel describes the resource data model.
type OnCallScheduleLayersResourceModel struct {
	Id                         types.String                     `tfsdk:"id"`
	OnCallDutyPolicyScheduleId types.String                     `tfsdk:"on_call_duty_policy_schedule_id"`
	Layers                     []OnCallScheduleLayersLayerModel `tfsdk:"layers"`
}

// OnCallScheduleLayersLayerModel is one layer the resource lists.
type OnCallScheduleLayersLayerModel struct {
	LayerId types.String   `tfsdk:"layer_id"`
	UserIds []types.String `tfsdk:"user_ids"`
}

// A person in a layer, as the API writes them: the row they are in the layer
// by, and who they are. A person added has no row yet.
type scheduleLayersUser struct {
	LayerUserId string `json:"layerUserId,omitempty"`
	UserId      string `json:"userId"`
}

// A layer as the API writes it: who takes turns in it, in turn order.
type scheduleLayersLayer struct {
	LayerId string               `json:"layerId"`
	Users   []scheduleLayersUser `json:"users"`
}

// What GET .../layers answers, and what save-layers is sent: every layer the
// schedule keeps, the highest priority first, and the version they are at.
type scheduleLayers struct {
	BasedOnVersion  string                `json:"basedOnVersion"`
	Layers          []scheduleLayersLayer `json:"layers"`
	DeletedLayerIds []string              `json:"deletedLayerIds"`
}

// A layer as this resource wants it: its people, in turn order.
type wantedScheduleLayer struct {
	LayerID string
	UserIDs []string
}

func (r *OnCallScheduleLayersResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_on_call_schedule_layers"
}

func (r *OnCallScheduleLayersResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Who takes turns in each layer of an on-call schedule, in turn order, and the order of the layers, saved all at once - as **Save changes** on a schedule's **Layers** page saves them. " +
			"One apply writes all of a change or none of it, and who is on call is worked out once, at once: someone who goes on or off call, or is next, hears it once. " +
			"List layers of the schedule by their `oneuptime_on_call_schedule_layer` IDs, the highest priority first, each with the people who take turns in it. " +
			"A layer it does not list keeps its people and its place. " +
			"Use it instead of `oneuptime_on_call_schedule_layer_user` for the layers it lists, not with it, and leave the listed layers' `order` unset. " +
			"Destroying it takes everyone out of the layers it lists.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "The schedule's ID: a schedule has one of these.",
				Computed:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"on_call_duty_policy_schedule_id": schema.StringAttribute{
				MarkdownDescription: "ID of the `" + scheduleLayersScheduleType + "` whose layers these are. Changing it replaces the resource.",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: RecordIDValidators(scheduleLayersScheduleType),
			},
			"layers": schema.ListNestedAttribute{
				MarkdownDescription: "Layers of the schedule, the highest priority first: the layer on top is the one that pages while someone in it is on call. Each layer once. The layers listed take the places they have in the schedule between them, in this order.",
				Required:            true,
				Validators: []validator.List{
					listvalidator.SizeAtLeast(1),
				},
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"layer_id": schema.StringAttribute{
							MarkdownDescription: "ID of the `" + scheduleLayersLayerType + "`: a layer of this schedule.",
							Required:            true,
							Validators:          RecordIDValidators(scheduleLayersLayerType),
						},
						"user_ids": schema.ListAttribute{
							MarkdownDescription: "User IDs of the people who take turns in the layer, in turn order: `[]` for nobody. Someone in the project, or invited to it - `oneuptime_team_member`'s `user_id`, or `data.oneuptime_user`'s `id` for someone named by email address.",
							Required:            true,
							ElementType:         types.StringType,
							Validators:          RecordIDListValidators(personResourceType),
						},
					},
				},
			},
		},
	}
}

func (r *OnCallScheduleLayersResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*Client)
	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Resource Configure Type",
			fmt.Sprintf("Expected *Client, got: %T. Please report this issue to the provider developers.", req.ProviderData),
		)
		return
	}

	r.client = client
}

// ValidateConfig refuses a layer listed twice, at plan time: OneUptime would
// refuse the save.
func (r *OnCallScheduleLayersResource) ValidateConfig(ctx context.Context, req resource.ValidateConfigRequest, resp *resource.ValidateConfigResponse) {
	var layers types.List
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root("layers"), &layers)...)
	if resp.Diagnostics.HasError() || layers.IsNull() || layers.IsUnknown() {
		return
	}

	// A layer, or its ID, known only at apply is left to the apply.
	seen := map[string]int{}
	for index, element := range layers.Elements() {
		layer, ok := element.(types.Object)
		if !ok || layer.IsNull() || layer.IsUnknown() {
			continue
		}
		layerID, ok := layer.Attributes()["layer_id"].(types.String)
		if !ok || layerID.IsNull() || layerID.IsUnknown() {
			continue
		}

		id := normalizeScheduleLayersID(layerID.ValueString())
		if first, ok := seen[id]; ok {
			resp.Diagnostics.AddAttributeError(
				path.Root("layers").AtListIndex(index).AtName("layer_id"),
				"Layer listed twice",
				fmt.Sprintf("Layer %s is listed at layers[%d] and layers[%d]: list each layer once, at the place it takes.", layerID.ValueString(), first, index),
			)
			continue
		}
		seen[id] = index
	}
}

func (r *OnCallScheduleLayersResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan OnCallScheduleLayersResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	scheduleID := plan.OnCallDutyPolicyScheduleId.ValueString()
	if err := r.saveWanted(ctx, scheduleID, wantedScheduleLayers(plan.Layers)); err != nil {
		resp.Diagnostics.AddError("Could not save the schedule's layers", err.Error())
		return
	}

	plan.Id = types.StringValue(scheduleID)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *OnCallScheduleLayersResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state OnCallScheduleLayersResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Just imported: the state lists no layers, so it takes them all.
	var layers types.List
	resp.Diagnostics.Append(req.State.GetAttribute(ctx, path.Root("layers"), &layers)...)
	if resp.Diagnostics.HasError() {
		return
	}

	scheduleID := state.OnCallDutyPolicyScheduleId.ValueString()
	saved, err := r.readLayers(ctx, scheduleID)
	if err != nil {
		resp.Diagnostics.AddError("Could not read the schedule's layers", err.Error())
		return
	}

	if saved == nil {
		resp.State.RemoveResource(ctx)
		return
	}

	state.Layers = scheduleLayersInState(saved, state.Layers, layers.IsNull())
	if state.Id.IsNull() || state.Id.IsUnknown() || state.Id.ValueString() == "" {
		state.Id = types.StringValue(scheduleID)
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *OnCallScheduleLayersResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan OnCallScheduleLayersResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	scheduleID := plan.OnCallDutyPolicyScheduleId.ValueString()
	if err := r.saveWanted(ctx, scheduleID, wantedScheduleLayers(plan.Layers)); err != nil {
		resp.Diagnostics.AddError("Could not save the schedule's layers", err.Error())
		return
	}

	if plan.Id.IsNull() || plan.Id.IsUnknown() {
		plan.Id = types.StringValue(scheduleID)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

// Delete takes everyone out of the layers the resource lists. Layers it does
// not list, and layers that are gone, are left as they are.
func (r *OnCallScheduleLayersResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state OnCallScheduleLayersResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	scheduleID := state.OnCallDutyPolicyScheduleId.ValueString()
	listed := map[string]bool{}
	for _, layer := range state.Layers {
		listed[normalizeScheduleLayersID(layer.LayerId.ValueString())] = true
	}

	err := r.save(ctx, scheduleID, true, func(saved *scheduleLayers) (*scheduleLayers, error) {
		// In the order the schedule has them, so no layer moves.
		emptied := []wantedScheduleLayer{}
		for _, layer := range saved.Layers {
			if listed[normalizeScheduleLayersID(layer.LayerId)] {
				emptied = append(emptied, wantedScheduleLayer{LayerID: layer.LayerId, UserIDs: []string{}})
			}
		}
		if len(emptied) == 0 {
			return nil, nil
		}
		return planScheduleLayersSave(saved, emptied)
	})
	if err != nil {
		resp.Diagnostics.AddError("Could not take everyone out of the schedule's layers", err.Error())
	}
}

// ImportState takes the schedule's ID, and with it every layer the schedule has.
func (r *OnCallScheduleLayersResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	id := strings.TrimSpace(req.ID)
	if !isRecordID(id) {
		resp.Diagnostics.AddError(
			"Not a schedule ID",
			fmt.Sprintf("Import %s by its schedule's ID, a UUID such as 550e8400-e29b-41d4-a716-446655440000: %q is not one.", "oneuptime_on_call_schedule_layers", req.ID),
		)
		return
	}

	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), id)...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("on_call_duty_policy_schedule_id"), id)...)
}

// wantedScheduleLayers is what a plan asks of the layers.
func wantedScheduleLayers(layers []OnCallScheduleLayersLayerModel) []wantedScheduleLayer {
	wanted := []wantedScheduleLayer{}
	for _, layer := range layers {
		userIDs := []string{}
		for _, userID := range layer.UserIds {
			userIDs = append(userIDs, userID.ValueString())
		}
		wanted = append(wanted, wantedScheduleLayer{LayerID: layer.LayerId.ValueString(), UserIDs: userIDs})
	}
	return wanted
}

// saveWanted gives the layers wanted their people and places.
func (r *OnCallScheduleLayersResource) saveWanted(ctx context.Context, scheduleID string, wanted []wantedScheduleLayer) error {
	return r.save(ctx, scheduleID, false, func(saved *scheduleLayers) (*scheduleLayers, error) {
		return planScheduleLayersSave(saved, wanted)
	})
}

// save reads the layers, makes the save change asks of them, and sends it -
// again, to the layers read again, when someone changed them in between.
// change answers nil for nothing to save. A schedule that is gone is an
// error, unless goneIsDone.
func (r *OnCallScheduleLayersResource) save(ctx context.Context, scheduleID string, goneIsDone bool, change func(saved *scheduleLayers) (*scheduleLayers, error)) error {
	for attempt := 1; ; attempt++ {
		saved, err := r.readLayers(ctx, scheduleID)
		if err != nil {
			return err
		}
		if saved == nil {
			if goneIsDone {
				return nil
			}
			return fmt.Errorf("on-call schedule %s was not found: it may have been deleted. Check on_call_duty_policy_schedule_id", scheduleID)
		}

		request, err := change(saved)
		if err != nil {
			return err
		}
		if request == nil {
			return nil
		}

		changedMeanwhile, err := r.sendSave(ctx, scheduleID, request)
		if err != nil {
			return err
		}
		if !changedMeanwhile {
			return nil
		}
		if attempt == scheduleLayersSaveAttempts {
			return fmt.Errorf("the layers of on-call schedule %s were changed by someone else each of the %d times they were saved, so nothing was saved: apply again", scheduleID, scheduleLayersSaveAttempts)
		}
	}
}

// readLayers reads the schedule's layers as they are saved: nil, nil when
// there is no such schedule.
func (r *OnCallScheduleLayersResource) readLayers(ctx context.Context, scheduleID string) (*scheduleLayers, error) {
	resp, err := r.client.Get(ctx, scheduleLayersPath(scheduleID)+"/layers")
	if err != nil {
		return nil, fmt.Errorf("reading the layers of on-call schedule %s: %w", scheduleID, err)
	}

	if resp.StatusCode == http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		// A OneUptime without the route answers 404 for a schedule that is there.
		exists, existsErr := r.scheduleExists(ctx, scheduleID)
		if existsErr != nil {
			return nil, existsErr
		}
		if exists {
			return nil, fmt.Errorf("this OneUptime cannot read a schedule's layers in one call (%s): update it, or keep its layers' people with %s_user resources", apiErrorMessage(body), scheduleLayersLayerType)
		}
		return nil, nil
	}

	var saved scheduleLayers
	if err := r.client.ParseResponse(resp, &saved); err != nil {
		return nil, fmt.Errorf("reading the layers of on-call schedule %s: %w", scheduleID, err)
	}
	if saved.BasedOnVersion == "" {
		return nil, fmt.Errorf("reading the layers of on-call schedule %s: OneUptime answered no basedOnVersion", scheduleID)
	}
	if saved.Layers == nil {
		saved.Layers = []scheduleLayersLayer{}
	}
	saved.DeletedLayerIds = []string{}

	return &saved, nil
}

// scheduleExists says whether the API key's project has the schedule.
func (r *OnCallScheduleLayersResource) scheduleExists(ctx context.Context, scheduleID string) (bool, error) {
	resp, err := r.client.Post(ctx, scheduleLayersPath(scheduleID)+"/get-item", map[string]interface{}{
		"select": map[string]interface{}{"_id": true},
	})
	if err != nil {
		return false, fmt.Errorf("reading on-call schedule %s: %w", scheduleID, err)
	}

	body, readErr := io.ReadAll(resp.Body)
	resp.Body.Close()
	if readErr != nil {
		return false, fmt.Errorf("reading on-call schedule %s: %w", scheduleID, readErr)
	}

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return false, nil
	case resp.StatusCode >= 400:
		return false, fmt.Errorf("reading on-call schedule %s: the OneUptime API returned status %d: %s", scheduleID, resp.StatusCode, apiErrorMessage(body))
	default:
		return strings.Contains(string(body), `"_id"`), nil
	}
}

// sendSave sends a save: true when OneUptime refused it because the layers
// changed after they were read (409), to read them again and save again.
func (r *OnCallScheduleLayersResource) sendSave(ctx context.Context, scheduleID string, request *scheduleLayers) (bool, error) {
	resp, err := r.client.Post(ctx, scheduleLayersPath(scheduleID)+"/save-layers", request)
	if err != nil {
		return false, fmt.Errorf("saving the layers of on-call schedule %s: %w", scheduleID, err)
	}

	if resp.StatusCode == http.StatusConflict {
		resp.Body.Close()
		return true, nil
	}

	if err := r.client.ParseResponse(resp, nil); err != nil {
		return false, fmt.Errorf("saving the layers of on-call schedule %s: %w", scheduleID, err)
	}

	return false, nil
}

func scheduleLayersPath(scheduleID string) string {
	return "/on-call-duty-policy-schedule/" + scheduleID
}

// OneUptime writes an ID in lower case, whatever case it was sent in.
func normalizeScheduleLayersID(id string) string {
	return strings.ToLower(strings.TrimSpace(id))
}

// findScheduleLayer is the saved layer with this ID, or nil.
func findScheduleLayer(saved *scheduleLayers, layerID string) *scheduleLayersLayer {
	for index := range saved.Layers {
		if normalizeScheduleLayersID(saved.Layers[index].LayerId) == normalizeScheduleLayersID(layerID) {
			return &saved.Layers[index]
		}
	}
	return nil
}

// planScheduleLayersSave is the save that gives each layer wanted its people,
// in turn order, and the layers wanted the places they have between them, in
// the order wanted. A layer not wanted keeps its people and its place, and
// nothing is deleted. Someone who stays in a layer keeps the row they are in
// it by, so their turn moves rather than being taken out and put back.
func planScheduleLayersSave(saved *scheduleLayers, wanted []wantedScheduleLayer) (*scheduleLayers, error) {
	listed := map[string]bool{}
	for _, layer := range wanted {
		id := normalizeScheduleLayersID(layer.LayerID)
		if listed[id] {
			return nil, fmt.Errorf("layer %s is listed twice: list each layer once", layer.LayerID)
		}
		if findScheduleLayer(saved, layer.LayerID) == nil {
			return nil, fmt.Errorf("%s is not a layer of this schedule: list the schedule's own layers, by the IDs of their %s resources", layer.LayerID, scheduleLayersLayerType)
		}
		listed[id] = true
	}

	request := &scheduleLayers{
		BasedOnVersion:  saved.BasedOnVersion,
		Layers:          []scheduleLayersLayer{},
		DeletedLayerIds: []string{},
	}

	next := 0
	for _, layer := range saved.Layers {
		if !listed[normalizeScheduleLayersID(layer.LayerId)] {
			request.Layers = append(request.Layers, layer)
			continue
		}

		want := wanted[next]
		next++
		have := findScheduleLayer(saved, want.LayerID)
		request.Layers = append(request.Layers, scheduleLayersLayer{
			LayerId: have.LayerId,
			Users:   scheduleLayersUsersInTurnOrder(have.Users, want.UserIDs),
		})
	}

	return request, nil
}

// scheduleLayersUsersInTurnOrder is a layer's people in the order given, each
// by a row they are in the layer by when they have one.
func scheduleLayersUsersInTurnOrder(rows []scheduleLayersUser, userIDs []string) []scheduleLayersUser {
	used := make([]bool, len(rows))
	users := []scheduleLayersUser{}

	for _, userID := range userIDs {
		user := scheduleLayersUser{UserId: userID}
		for index, row := range rows {
			if !used[index] && row.LayerUserId != "" && normalizeScheduleLayersID(row.UserId) == normalizeScheduleLayersID(userID) {
				used[index] = true
				user = scheduleLayersUser{LayerUserId: row.LayerUserId, UserId: row.UserId}
				break
			}
		}
		users = append(users, user)
	}

	return users
}

// scheduleLayersInState is the state's layers as the schedule has them: the
// layers it lists - every layer, just imported - in the order the schedule
// has them, each with its people in turn order. An ID keeps the spelling the
// state had it in.
func scheduleLayersInState(saved *scheduleLayers, prior []OnCallScheduleLayersLayerModel, imported bool) []OnCallScheduleLayersLayerModel {
	priorByID := map[string]OnCallScheduleLayersLayerModel{}
	for _, layer := range prior {
		priorByID[normalizeScheduleLayersID(layer.LayerId.ValueString())] = layer
	}

	layers := []OnCallScheduleLayersLayerModel{}
	for _, layer := range saved.Layers {
		was, listed := priorByID[normalizeScheduleLayersID(layer.LayerId)]
		if !imported && !listed {
			continue
		}

		layerID := layer.LayerId
		if listed {
			layerID = was.LayerId.ValueString()
		}

		userIDs := []types.String{}
		for _, user := range layer.Users {
			userIDs = append(userIDs, types.StringValue(scheduleLayersSpelledAs(user.UserId, was.UserIds)))
		}

		layers = append(layers, OnCallScheduleLayersLayerModel{
			LayerId: types.StringValue(layerID),
			UserIds: userIDs,
		})
	}

	return layers
}

// scheduleLayersSpelledAs is an ID as one of spellings writes it, if one does.
func scheduleLayersSpelledAs(id string, spellings []types.String) string {
	for _, spelling := range spellings {
		if normalizeScheduleLayersID(spelling.ValueString()) == normalizeScheduleLayersID(id) {
			return spelling.ValueString()
		}
	}
	return id
}
