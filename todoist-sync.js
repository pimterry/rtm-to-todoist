// This should be a nicer standalone todoist model, preferrably with some backing from Doist themselves.

var _ = require("lodash");
var request = require("request-promise");
var uuid = require("node-uuid");

var ROOT_URL = "https://todoist.com/API/v7";

var token = null;
var minutesOffset = 0;

// TODO: Move this to headless OAuth, somehow
exports.login = function (email, password) {
    return request.post(`${ROOT_URL}/user/login`, {
        form: {
            email: email,
            password: password
        },
        json: true
    }).then((response) => {
        token = response.token;
        // TODO: Not currently used, but could be useful to make dates work nicely?
        minutesOffset = response.tz_info.hours * 60;
    });
};

// ** High-level APIs **

exports.addItems = function (items) {
    var itemCommands = items.map((item) => ({
        type: "item_add",
        temp_id: uuid.v1(),
        uuid: uuid.v1(),
        args: item
    }));

    console.log(itemCommands);

    // TODO: There must be a nicer way to write this recursion out
    if (itemCommands.length > 100) {
        var remainingItemCommands = _.drop(items, 100);
        itemCommands = _.take(itemCommands, 100);
    }

    var result = exports.writeResources(itemCommands).then((response) => {
        console.log(JSON.stringify(response));

        var errors = itemCommands.filter((item) => response.sync_status[item.uuid] !== "ok")
                                 .map((item) => ({ item: item, error: response.sync_status[item.uuid] }));
        if (errors.length > 0) throw new Error(`Failed to create items: ${JSON.stringify(errors)}`);

        // TODO: Maybe return something here? With a good temp_id this would be easy.
    });

    if (remainingItemCommands) {
        return result.then(() => exports.addItems(remainingItemCommands));
    } else {
        return result;
    }
};

exports.addLabels = function (labels) {
    var labelCommands = labels.map((label) => ({
        type: "label_add",
        temp_id: label.name,
        uuid: uuid.v1(),
        args: label
    }));

    console.log(labelCommands);
    return exports.writeResources(labelCommands).then((response) => {
        console.log(JSON.stringify(response));

        // TODO: Refactor UUID and error handling into writeResources
        var errors = labelCommands.filter((label) => response.sync_status[label.uuid] !== "ok")
                                  .map((label) => ({ label: label, error: response.sync_status[label.uuid] }));
        if (errors.length > 0) throw new Error(`Failed to create items: ${JSON.stringify(errors)}`);

        return response.temp_id_mapping;
    });
};

// ** Low-level APIs **

exports.readResources = function (resourceTypes = ['all'], syncToken="*") {
    if (!token) throw new Error("Not authenticated - call login() first");

    return request.post(`${ROOT_URL}/sync`, {
        form: {
            token: token,
            resource_types: resourceTypes,
            sync_token: syncToken,
        },
        json: true
    });
};

exports.writeResources = function (commands) {
    if (!token) throw new Error("Not authenticated - call login() first");

    return request.post(`${ROOT_URL}/sync`, {
        form: {
            token: token,
            commands: JSON.stringify(commands)
        },
        json: true
    });
};
