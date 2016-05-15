var RTM = require("rtm-js");
var open = require("open");

module.exports = function (rtmApiKey, rtmSecret, todoistEmail, todoistPassword) {
    getTasksFromRtm(rtmApiKey, rtmSecret)
        .then((tasks) => {
            var convertedTasks = tasks.map(convertTaskToTodoist);
            addTasksToTodoist(todoistEmail, todoistPassword, convertedTasks)
        })
        .catch((e) => console.error("Failed to move tasks!", e));
}

function getTasksFromRtm(rtmApiKey, rtmSecret) {
    var rtm = new RTM(rtmApiKey, rtmSecret, 'read');

    return authenticateRtm(rtm).then(() => {
        return new Promise((resolve, reject) => {
            rtm.get('rtm.tasks.getList', {filter: 'status:incomplete'}, function(resp) {
                if (!resp.rsp || !resp.rsp.tasks || !resp.rsp.tasks.list || !resp.rsp.tasks.list[0].taskseries) {
                    reject(`No tasks returned by RTM: ${JSON.stringify(resp)}`);
                }

                var rawTasks = resp.rsp.tasks.list[0].taskseries;
                var tasks = rawTasks.map((task) => ({
                    name: task.name, // string task name
                    priority: task.priority, // 1, 2, 3, N
                    tags: task.tags.tag, // list of tag string
                    notes: task.notes, // {'note': note object}. What happens for multiple notes???
                    dueDate: task.task.due, // ISO-8601 string or undefined
                    url: task.url, // string or undefined
                    repeats: task.rrule // Undef or { every: 1, $t: "BYDAY=MO;FREQ=WEEKLY;INTERVAL=1" }
                }));
                resolve(tasks);
            });
        });
    });

    // Want: Name, priority, dates, notes, URL, repeating status
}

function authenticateRtm(rtm) {
    return new Promise((resolve, reject) => {
        rtm.get('rtm.auth.getFrob', function (resp) {
            frob = resp.rsp.frob;

            var authUrl = rtm.getAuthUrl(frob);
            open(authUrl);
            console.log("An authentication page has been opened in your browser.\n");
            console.log("If required, please confirm permissions, then press any key to continue\n");
            process.stdin.resume();

            process.stdin.on('data', function() {
                console.log("Continuing...");

                rtm.get('rtm.auth.getToken', {frob: frob}, function(resp){
                    if (!resp.rsp.auth) {
                        reject('Auth token not found. Did you authenticate?');
                    }

                    rtm.auth_token = resp.rsp.auth.token;

                    resolve();
                });
            });
        });
    });
}

function convertTaskToTodoist(rtmTask) {
    return rtmTask;
    return {
        content: task.name,
        priority: {
            1: 4,
            2: 3,
            3: 2,
            'N': 1
        }[task.priority],

    };
}


function addTasksToTodoist(todoistEmail, todoistPassword, tasks) {
    throw new Error("Todoist import not yet implemented, failed to import tasks: " + JSON.stringify(tasks));
}
