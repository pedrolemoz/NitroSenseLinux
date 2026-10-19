// SPDX-License-Identifier: GPL-2.0-only
/* Acer Nitro ANV15-52 battery limit through its battery-health WMI protocol.
 * Protocol reference: frederik-h/acer-wmi-battery, methods 20 and 21.
 * No EC offsets, calibration, or writes during probe/unload.
 */
#include <linux/acpi.h>
#include <linux/dmi.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/slab.h>
#include <linux/wmi.h>

#define CHARGE_GUID "79772EC5-04B1-4BFD-843C-61E7F77B6CC9"
struct charge_device {
	struct mutex lock;
};

/* Check type and size before touching firmware output, including error replies. */
static int charge_call(struct wmi_device *wdev, u32 method, u8 *input,
		       size_t input_size, u8 *reply, size_t reply_size)
{
	struct acpi_buffer in = { input_size, input };
	struct acpi_buffer out = { ACPI_ALLOCATE_BUFFER, NULL };
	union acpi_object *obj;
	acpi_status status;
	int ret = -EIO;

	status = wmidev_evaluate_method(wdev, 0, method, &in, &out);
	obj = out.pointer;
	if (ACPI_SUCCESS(status) && obj && obj->type == ACPI_TYPE_BUFFER &&
	    obj->buffer.length == reply_size) {
		memcpy(reply, obj->buffer.pointer, reply_size);
		ret = 0;
	}
	kfree(out.pointer);
	return ret;
}

static int charge_read(struct wmi_device *wdev, unsigned int *limit, bool *calibrating)
{
	u8 query[4] = { 1, 1, 0, 0 };
	u8 reply[8];
	int ret = charge_call(wdev, 20, query, sizeof(query), reply, sizeof(reply));

	if (ret)
		return ret;
	/* Function bit 0 is the fixed 80% health mode; bit 1 is calibration. */
	if (!(reply[0] & 1))
		return -EOPNOTSUPP;
	if (reply[3] > 1)
		return -EPROTO;
	*limit = reply[3] ? 80 : 100;
	*calibrating = (reply[0] & 2) && reply[4];
	return 0;
}

static ssize_t charge_control_end_threshold_show(struct device *dev,
		struct device_attribute *attr, char *buf)
{
	struct charge_device *charge = dev_get_drvdata(dev);
	unsigned int limit;
	bool calibrating;
	int ret;

	mutex_lock(&charge->lock);
	ret = charge_read(to_wmi_device(dev), &limit, &calibrating);
	mutex_unlock(&charge->lock);
	return ret ? ret : sysfs_emit(buf, "%u\n", limit);
}

static ssize_t charge_control_end_threshold_store(struct device *dev,
		struct device_attribute *attr, const char *buf, size_t count)
{
	struct charge_device *charge = dev_get_drvdata(dev);
	struct wmi_device *wdev = to_wmi_device(dev);
	unsigned int requested, actual;
	bool calibrating;
	u8 input[8] = { 1, 1, 0, 0, 0, 0, 0, 0 }, reply[4];
	int ret;

	ret = kstrtouint(buf, 10, &requested);
	if (ret || (requested != 80 && requested != 100))
		return -EINVAL;
	mutex_lock(&charge->lock);
	ret = charge_read(wdev, &actual, &calibrating);
	if (ret)
		goto out;
	if (calibrating) {
		ret = -EBUSY;
		goto out;
	}
	if (actual == requested)
		goto out;
	input[2] = requested == 80;
	ret = charge_call(wdev, 21, input, sizeof(input), reply, sizeof(reply));
	if (ret)
		goto out;
	/* Firmware readback is authoritative; never cache the requested value. */
	ret = charge_read(wdev, &actual, &calibrating);
	if (!ret && actual != requested)
		ret = -EIO;
out:
	mutex_unlock(&charge->lock);
	return ret ? ret : count;
}
static DEVICE_ATTR_RW(charge_control_end_threshold);
static struct attribute *charge_attrs[] = {
	&dev_attr_charge_control_end_threshold.attr, NULL
};
static const struct attribute_group charge_group = { .attrs = charge_attrs };

static int charge_probe(struct wmi_device *wdev, const void *context)
{
	struct charge_device *charge;
	unsigned int limit;
	bool calibrating;
	int ret;

	if (!dmi_match(DMI_SYS_VENDOR, "Acer") ||
	    !dmi_match(DMI_PRODUCT_NAME, "Nitro ANV15-52"))
		return -ENODEV;
	charge = devm_kzalloc(&wdev->dev, sizeof(*charge), GFP_KERNEL);
	if (!charge)
		return -ENOMEM;
	mutex_init(&charge->lock);
	dev_set_drvdata(&wdev->dev, charge);
	ret = charge_read(wdev, &limit, &calibrating);
	if (ret)
		return dev_err_probe(&wdev->dev, ret, "Battery health query failed\n");
	dev_info(&wdev->dev, "Firmware charge limit: %u%%; calibration: %s\n",
		 limit, calibrating ? "active" : "inactive");
	return devm_device_add_group(&wdev->dev, &charge_group);
}
static const struct wmi_device_id charge_ids[] = {
	{ .guid_string = CHARGE_GUID }, {}
};
MODULE_DEVICE_TABLE(wmi, charge_ids);
static struct wmi_driver charge_driver = {
	.driver = { .name = "nitrosense_charge" },
	.id_table = charge_ids,
	.probe = charge_probe,
};
module_wmi_driver(charge_driver);
MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("Acer Nitro ANV15-52 verified battery charge limit");
